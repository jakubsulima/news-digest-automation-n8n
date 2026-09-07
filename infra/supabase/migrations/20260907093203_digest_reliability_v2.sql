begin;

-- Durable v2 digest execution. Additive and safe for legacy v1 runs.
alter table public.pipeline_stage_runs drop constraint if exists pipeline_stage_runs_stage_name_check;
alter table public.pipeline_stage_runs add constraint pipeline_stage_runs_stage_name_check check (
  stage_name in ('source_fetch','article_normalization','story_clustering','enrichment','editorial_scoring','reader_publication','ai_brief','finalization')
);
alter table public.pipeline_stage_runs add column if not exists next_attempt_at timestamptz;
alter table public.pipeline_stage_runs add column if not exists lease_token uuid;
alter table public.pipeline_stage_runs add column if not exists lease_expires_at timestamptz;

create index if not exists pipeline_stage_runs_ready_idx
  on public.pipeline_stage_runs (next_attempt_at, created_at)
  where status = 'queued';
create index if not exists pipeline_stage_runs_expired_lease_idx
  on public.pipeline_stage_runs (lease_expires_at)
  where status = 'running';

create table if not exists public.digest_brief_jobs (
  digest_run_id uuid primary key references public.digest_runs(id) on delete cascade,
  input_payload jsonb not null,
  input_hash text not null,
  prompt_version text not null,
  status text not null check (status in ('pending','generating','retry_wait','generated','fallback','skipped','failed','cancelled')),
  reason text,
  generation_attempt_count integer not null default 0 check (generation_attempt_count >= 0),
  retry_cycle integer not null default 0 check (retry_cycle >= 0),
  candidate_payload jsonb,
  model text,
  last_error_code text,
  infrastructure_attempt_count integer not null default 0 check (infrastructure_attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.digest_brief_jobs enable row level security;
revoke all on public.digest_brief_jobs from anon, authenticated;
grant select, insert, update, delete on public.digest_brief_jobs to service_role;

drop trigger if exists set_digest_brief_jobs_updated_at on public.digest_brief_jobs;
create trigger set_digest_brief_jobs_updated_at before update on public.digest_brief_jobs
for each row execute function public.set_updated_at();

alter table public.digest_summaries add column if not exists generation_kind text not null default 'legacy'
  check (generation_kind in ('ai','fallback','legacy'));
alter table public.digest_summaries add column if not exists generation_reason text;
alter table public.digest_summaries add column if not exists model text;
alter table public.digest_summaries add column if not exists prompt_version text;
alter table public.digest_summaries add column if not exists input_hash text;

create or replace function public.create_or_get_digest_run_v2(p_user_id uuid, p_report_date date, p_enable_v2 boolean)
returns public.digest_runs
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_run public.digest_runs; v_stages text[];
begin
  select * into v_run from public.digest_runs where status in ('queued','running') order by created_at desc limit 1;
  if found then return v_run; end if;
  v_stages := case when p_enable_v2 then array['source_fetch','article_normalization','story_clustering','enrichment','editorial_scoring','reader_publication','ai_brief','finalization'] else array['source_fetch','article_normalization','story_clustering','enrichment','editorial_scoring','reader_publication','finalization'] end;
  insert into public.digest_runs(report_date,trigger_type,status,started_by_user_id,metadata)
  values(p_report_date,'manual','queued',p_user_id,jsonb_build_object('pipelineVersion',case when p_enable_v2 then 2 else 1 end)) returning * into v_run;
  insert into public.pipeline_stage_runs(digest_run_id,stage_name,status) select v_run.id, unnest(v_stages), 'queued';
  return v_run;
exception when unique_violation then
  select * into v_run from public.digest_runs where status in ('queued','running') order by created_at desc limit 1;
  if v_run.id is null then raise; end if;
  return v_run;
end $$;

create or replace function public.claim_next_digest_stage(p_run_id uuid, p_lease_seconds integer default 150)
returns public.pipeline_stage_runs
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_run public.digest_runs; v_stage public.pipeline_stage_runs; v_expected text[]; v_name text; v_row public.pipeline_stage_runs;
begin
  select * into v_run from public.digest_runs where id=p_run_id and status in ('queued','running') for update;
  if not found then return null; end if;
  v_expected := case when coalesce((v_run.metadata->>'pipelineVersion')::int,1)=2 then array['source_fetch','article_normalization','story_clustering','enrichment','editorial_scoring','reader_publication','ai_brief','finalization'] else array['source_fetch','article_normalization','story_clustering','enrichment','editorial_scoring','reader_publication','finalization'] end;
  if (select count(*) from public.pipeline_stage_runs where digest_run_id=p_run_id) <> cardinality(v_expected) then raise exception 'incomplete_stage_set'; end if;
  foreach v_name in array v_expected loop
    select * into v_row from public.pipeline_stage_runs where digest_run_id=p_run_id and stage_name=v_name for update;
    if not found then raise exception 'missing_stage:%',v_name; end if;
    if v_row.status in ('succeeded','skipped') then continue; end if;
    if v_row.status='failed' then raise exception 'failed_predecessor:%',v_name; end if;
    if v_row.status='running' and v_row.lease_expires_at > now() then return null; end if;
    if v_row.status='queued' and v_row.next_attempt_at > now() then return null; end if;
    update public.pipeline_stage_runs set status='running',attempt_count=attempt_count+1,started_at=now(),finished_at=null,error_message=null,next_attempt_at=null,lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
      where id=v_row.id returning * into v_stage;
    update public.digest_runs set status='running',started_at=coalesce(started_at,now()) where id=p_run_id;
    return v_stage;
  end loop;
  return null;
end $$;

create or replace function public.finish_digest_stage(p_stage_id uuid,p_lease_token uuid,p_status text,p_metrics jsonb default '{}'::jsonb,p_error text default null,p_next_attempt_at timestamptz default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if p_status not in ('queued','succeeded','failed','skipped') then raise exception 'invalid_terminal_stage_status'; end if;
  update public.pipeline_stage_runs set status=p_status,metrics=coalesce(p_metrics,'{}'),error_message=p_error,next_attempt_at=p_next_attempt_at,finished_at=case when p_status in ('succeeded','failed','skipped') then now() else null end,started_at=case when p_status='queued' then null else started_at end,lease_token=null,lease_expires_at=null
  where id=p_stage_id and status='running' and lease_token=p_lease_token;
  return found;
end $$;

create or replace function public.start_digest_brief_attempt(p_run_id uuid,p_lease_token uuid)
returns public.digest_brief_jobs language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_job public.digest_brief_jobs;
begin
  if not exists(select 1 from public.pipeline_stage_runs where digest_run_id=p_run_id and stage_name='ai_brief' and status='running' and lease_token=p_lease_token) then raise exception 'lease_lost'; end if;
  update public.digest_brief_jobs set status='generating',generation_attempt_count=generation_attempt_count+1,last_error_code=null where digest_run_id=p_run_id and status in ('pending','retry_wait') returning * into v_job;
  if v_job.digest_run_id is null then raise exception 'job_not_ready'; end if;
  return v_job;
end $$;

create or replace function public.save_digest_brief_candidate(p_run_id uuid,p_lease_token uuid,p_candidate jsonb,p_model text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.digest_brief_jobs j set candidate_payload=p_candidate,model=p_model,status='generated'
  where j.digest_run_id=p_run_id and exists(select 1 from public.pipeline_stage_runs s where s.digest_run_id=p_run_id and s.stage_name='ai_brief' and s.status='running' and s.lease_token=p_lease_token);
  return found;
end $$;

create or replace function public.commit_digest_brief(p_run_id uuid,p_lease_token uuid,p_summary jsonb,p_kind text,p_reason text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.digest_brief_jobs; r public.digest_runs;
begin
  select * into j from public.digest_brief_jobs where digest_run_id=p_run_id for update;
  select * into r from public.digest_runs where id=p_run_id and status in ('queued','running') for update;
  if r.id is null or not exists(select 1 from public.pipeline_stage_runs where digest_run_id=p_run_id and stage_name='ai_brief' and status='running' and lease_token=p_lease_token) then return false; end if;
  insert into public.digest_summaries(digest_run_id,digest_date,summary,highlights,sections,watchlist,coverage_note,reading_time_minutes,generation_kind,generation_reason,model,prompt_version,input_hash)
  values(p_run_id,r.report_date,p_summary->>'summary',coalesce(p_summary->'highlights','[]'),coalesce(p_summary->'sections','[]'),coalesce(p_summary->'watchlist','[]'),coalesce(p_summary->>'coverageNote',''),coalesce((p_summary->>'readingTimeMinutes')::int,1),p_kind,p_reason,j.model,j.prompt_version,j.input_hash)
  on conflict(digest_run_id) do update set summary=excluded.summary,highlights=excluded.highlights,sections=excluded.sections,watchlist=excluded.watchlist,coverage_note=excluded.coverage_note,reading_time_minutes=excluded.reading_time_minutes,generation_kind=excluded.generation_kind,generation_reason=excluded.generation_reason,model=excluded.model,prompt_version=excluded.prompt_version,input_hash=excluded.input_hash;
  update public.digest_brief_jobs set status=case when p_kind='ai' then 'generated' else case when p_reason in ('disabled','insufficient_evidence','no_articles') then 'skipped' else 'fallback' end end,reason=p_reason,completed_at=now() where digest_run_id=p_run_id;
  update public.pipeline_stage_runs set status='succeeded',finished_at=now(),lease_token=null,lease_expires_at=null where digest_run_id=p_run_id and stage_name='ai_brief' and lease_token=p_lease_token;
  return found;
end $$;

revoke execute on function public.create_or_get_digest_run_v2(uuid,date,boolean) from public,anon,authenticated;
revoke execute on function public.claim_next_digest_stage(uuid,integer) from public,anon,authenticated;
revoke execute on function public.finish_digest_stage(uuid,uuid,text,jsonb,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.start_digest_brief_attempt(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.save_digest_brief_candidate(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.commit_digest_brief(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_or_get_digest_run_v2(uuid,date,boolean), public.claim_next_digest_stage(uuid,integer), public.finish_digest_stage(uuid,uuid,text,jsonb,text,timestamptz), public.start_digest_brief_attempt(uuid,uuid), public.save_digest_brief_candidate(uuid,uuid,jsonb,text), public.commit_digest_brief(uuid,uuid,jsonb,text,text) to service_role;

create or replace function public.retry_digest_brief(p_run_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_job public.digest_brief_jobs;
begin
  if exists(select 1 from public.digest_runs where id<>p_run_id and status in ('queued','running')) then raise exception 'another_active_digest_run'; end if;
  select * into v_job from public.digest_brief_jobs where digest_run_id=p_run_id for update;
  if not found or v_job.status not in ('fallback','failed','skipped') then return false; end if;
  update public.digest_runs set status='queued',finished_at=null,error_message=null where id=p_run_id;
  update public.digest_brief_jobs set retry_cycle=retry_cycle+1,generation_attempt_count=0,status='pending',reason=null,last_error_code=null,completed_at=null where digest_run_id=p_run_id;
  update public.pipeline_stage_runs set status=case when stage_name in ('ai_brief','finalization') then 'queued' else status end,started_at=null,finished_at=null,error_message=null,next_attempt_at=null,lease_token=null,lease_expires_at=null where digest_run_id=p_run_id and stage_name in ('ai_brief','finalization');
  return true;
end $$;
revoke execute on function public.retry_digest_brief(uuid) from public,anon,authenticated;
grant execute on function public.retry_digest_brief(uuid) to service_role;

commit;
