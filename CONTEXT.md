# Daily News Digest Context

Daily News Digest is a private hosted news reader and digest builder.

## Language

**Hosted Production**
The Vercel-deployed Next.js app and cron-triggered digest pipeline.

**Digest Builder**
The TypeScript pipeline that turns configured RSS sources into ranked reader items.

**Pipeline Memory**
Historical Supabase records used to recognize repeated or changed stories.

**Pipeline Stage**
A persisted, retryable unit of digest-building work.

**Reader Item**
A story prepared for the private reader feed.

**Source Item**
A raw item received from a configured news source during a digest run.

**Run Trigger**
The user action or schedule that starts a digest run.

**Operator**
An allowed user who can start and observe digest runs.

**Stage Executor**
The Vercel cron endpoint that advances one bounded unit of pipeline work.

**Digest State**
The Supabase record of runs, stages, source items, articles, story clusters, snapshots, and reader items.

**Recommendation Decision**
A versioned explanation of why a Story Cluster was eligible, selected, ranked, or explored.

**Exposure**
A Reader Item that was actually visible to the Operator long enough to count as recommendation evidence.

**Source Portfolio**
The immutable source selection snapshot used by one digest run, including selected, exploration, probe, and skipped sources.

**Preference Signal**
Explicit or behavioral evidence about a topic, entity, source, repetition, or quality.

## Relationships

- Hosted Production does not depend on local workflow automation.
- The Digest Builder uses Pipeline Memory to produce Reader Items.
- Only one digest run may be active at a time.
- A Run Trigger starts a run; the Stage Executor advances it.
- Source Items are per-run evidence before they become Pipeline Memory.
- Reader Items are durable story-cluster projections retained for 90 days; saved items, Pipeline Memory, and run history are retained longer.
- Recommendation Decisions are versioned so policy changes can run in shadow mode and be audited.
- An Exposure is recorded from actual Reader visibility, not from inclusion in a feed response.
- A Source Portfolio is frozen before a run fetches sources and is reused when that run retries.
