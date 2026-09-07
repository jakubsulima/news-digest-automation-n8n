-- Run with psql variables app_url and cron_secret_name after enabling pg_cron,
-- pg_net and Vault. The secret value is read from Vault and never stored here.
do $$ begin
  if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'pg_cron and pg_net must be enabled';
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname='digest-stage-watchdog-v2';
select cron.schedule('digest-stage-watchdog-v2','* * * * *',format($job$
  select net.http_get(
    url := %L || '/api/digest-runs/advance',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name=%L)),
    timeout_milliseconds := 5000
  )
  where exists (
    select 1 from public.pipeline_stage_runs s join public.digest_runs r on r.id=s.digest_run_id
    where r.status in ('queued','running') and ((s.status='queued' and coalesce(s.next_attempt_at,now())<=now()) or (s.status='running' and s.lease_expires_at<=now()))
  );
$job$, :'app_url', :'cron_secret_name'));
