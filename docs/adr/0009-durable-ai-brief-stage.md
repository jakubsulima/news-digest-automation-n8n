# ADR-0009: Durable AI briefing stage

## Status

Accepted.

## Decision

Pipeline v2 adds `ai_brief` between reader publication and finalization. Publication freezes a bounded, canonically hashed input and writes a usable fallback before completing. AI work is claimed with a 150-second lease, performs at most one provider request per worker invocation, checkpoints a valid candidate, and commits candidate, summary, job state, and stage state transactionally.

Retries use the frozen input. A Supabase Cron watchdog signals the worker every minute through `pg_net`; the browser is only an observer. Delivery is at-least-once, while writes are idempotent and fenced by lease tokens. Existing v1 runs retain their original stage list.

## Consequences

- publishing news is independent of provider availability;
- a crash may repeat an external AI call, so exactly-once generation is not claimed;
- v2 activation is gated by `DIGEST_PIPELINE_V2_ENABLED` and requires the migration and watchdog first;
- cleanup is not part of v2 availability and runs separately.
