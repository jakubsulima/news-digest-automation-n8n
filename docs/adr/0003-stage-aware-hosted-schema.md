# Stage-Aware Hosted Schema

The hosted pipeline schema will model digest runs and pipeline stage runs explicitly instead of copying the local Python store schema as-is. The schema will still preserve the current domain concepts, including runs, source items, articles, story clusters, snapshots, and reader-facing news items, but it will make stage status, retries, and partial failures first-class so the hosted pipeline can run safely on Vercel and later move to a queue-backed executor.

**Considered Options**

- Copy the local PostgreSQL tables directly.
- Store only final reader-facing news items.
- Design a stage-aware schema mapped from the existing pipeline concepts.

**Consequences**

- Migration code must map existing builder outputs into the hosted schema.
- Existing reader table names can remain where practical to avoid unnecessary app churn.
- Stage retry behavior can be implemented without changing the reader-facing model.
