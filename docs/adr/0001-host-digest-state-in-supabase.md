# Host Digest State In Supabase

Daily News Digest will move production digest state from the local PostgreSQL database and Markdown files into Supabase rows. Supabase will store both internal pipeline state and final reader items, while the reader UI will initially expose only reader items; this keeps hosted production independent from the user's personal computer without turning the reader into a full pipeline control plane.

**Considered Options**

- Keep only final reader items in Supabase and leave pipeline memory local.
- Store Markdown digests as the hosted source of truth.
- Store full digest state in Supabase and render reader views from database rows.

**Consequences**

- The hosted pipeline can retry and inspect individual stages without relying on local files.
- The data model must distinguish internal pipeline state from reader-facing items.
- Markdown can be regenerated later as an export format, but it is not canonical state.
