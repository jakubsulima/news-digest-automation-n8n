# Daily News Digest Project Structure

## Purpose

Daily News Digest is one personal news product composed of:

- a local n8n automation runtime
- a Python digest builder
- local PostgreSQL pipeline memory
- a private Next.js reader app
- Supabase Auth and Supabase Postgres for reader-facing data

The repository is a single product monorepo. n8n is one subsystem, not the root identity of the project.

## Current Structure

```text
daily-news-digest/
  apps/
    reader/
      app/
      components/
      lib/
      package.json
      next.config.ts
      .env.example
  config/
    editorial-settings.json
    rss-sources.json
  docs/
    ingest-contract.md
    project-structure.md
  infra/
    supabase/
      migrations/
  prompts/
    ai-editorial-review.md
    nvidia-news-editor.md
  scripts/
    build_digest.py
    digest_service.py
    digest_store.py
  storage/
    digests/
  workflows/
    daily-news-digest-build.json
    daily-news-digest-get-latest.json
  docker-compose.yml
  Dockerfile.digest-builder
  Dockerfile.reader
  package.json
  pnpm-workspace.yaml
```

The root `docker-compose.yml` remains the main local runtime command surface:

```bash
docker compose up -d
```

## Current Architecture

```text
Local runtime:
  n8n
  digest-builder
  local PostgreSQL
  Next.js reader container

External reader services:
  Supabase Auth
  Supabase Postgres

Sync boundary:
  selected reader items -> Next.js /api/ingest -> Supabase reader tables
```

The local pipeline remains useful on its own: it builds Markdown digests, stores pipeline memory locally, and exposes the latest digest through a private n8n webhook.

The reader app is separate from that local pipeline state. It stores only reader-facing items and user state in Supabase so it can work with Supabase Auth and, later, a hosted deployment.

This creates two databases by design:

- local PostgreSQL stores pipeline history, clustering memory, enriched text, and build state
- Supabase stores reader-facing items and per-user read/save/archive state

## Reader Scope

Implemented:

- private email/password login
- allowed-reader email check
- feed of reader-facing news items
- article/detail view
- read/unread state
- saved/bookmarked state
- archive/hide state
- mobile-first shadcn/ui layout
- protected ingest API route

Not in the current reader:

- RSS source editing
- prompt editing
- scoring rule editing
- n8n schedule editing
- manual control of digest-builder runs
- full candidate story review
- enriched full-text article archive
- source/category filtering UI

## Reader Data Model

Reader-facing items live in Supabase:

```text
news_items
  id
  external_id
  digest_date
  title
  summary
  source
  source_url
  category
  importance_score
  published_at
  raw_payload
  created_at
  updated_at
```

Reader state is stored separately:

```text
reader_item_states
  news_item_id
  user_id
  read_at
  saved_at
  archived_at
  created_at
  updated_at
```

The local pipeline may continue storing richer internal state, including enriched article text and clustering metadata.

## Ingest Boundary

n8n or another local client should send selected reader items to the Next.js API route:

```text
POST /api/ingest
Authorization: Bearer <INGEST_SECRET>
```

The Next.js app owns:

- request authentication
- payload validation
- deduplication/upsert behavior
- writes to Supabase

n8n should not write directly to Supabase in this version. That avoids storing Supabase service credentials inside n8n and keeps validation logic near the reader app.

The ingest contract lives in:

```text
docs/ingest-contract.md
apps/reader/lib/ingest-schema.ts
```

A shared package such as `packages/news-contracts/` is postponed until multiple codebases need to import the same TypeScript schema.

## Deployment

Current default deployment is local Docker Compose:

```text
http://127.0.0.1:5678  n8n
http://127.0.0.1:3000  reader
```

The reader can later be hosted on Vercel without changing the ingest contract:

```text
https://daily-news-digest-reader.vercel.app/api/ingest
```

The hosted app must not call local n8n directly. The local machine should push data outward to the hosted ingest endpoint. Future control features should use a command queue or polling model so the local runtime still only makes outbound requests.

## Rejected Alternatives

### Separate Next.js Repository

Rejected for this version.

The reader, automation, digest builder, schema, and ingest contract are one system. A separate repo would make payload and schema drift more likely.

### Supabase As The Only Database Immediately

Rejected for now, but still possible later.

Writing the pipeline directly to Supabase would be cleaner long term, but it requires migrating the current Python persistence layer before the reader app has proven its value.

### Local PostgreSQL As The Reader Database

Rejected for hosted use.

It would require exposing or tunneling the local database to the hosted app. That adds networking and security complexity without improving the reader experience.

### Full Admin Control App

Rejected for the current reader.

Editing sources, prompts, schedules, and scoring rules from the app is useful later, but it changes the app into a control plane. The first reader should stay focused on private reading.

## Security Model

Reader access:

- Supabase Auth
- allowed-reader email check
- RLS-backed access checks
- all reader pages require an authenticated session

Ingest access:

- `Authorization: Bearer <INGEST_SECRET>`
- payload validation before writes
- server-side Supabase service role access only

Local runtime access:

- n8n bound to localhost by default
- reader bound to localhost by default
- digest-builder not published to the host
- Tailscale recommended for private webhook access from other devices
