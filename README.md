# Daily News Digest

Daily News Digest is a private Vercel-hosted news reader. It fetches configured RSS sources, builds a staged digest pipeline, stores state in Supabase, and shows the latest reader-facing digest behind Supabase Auth.

## Architecture

```text
Vercel Cron -> /api/digest-runs/advance -> Supabase digest state
Reader UI -> /api/digest-runs -> Supabase status/feed data
RSS sources -> staged TypeScript pipeline -> latest news_items
```

The active runtime is:

- `apps/reader`: Next.js App Router reader and API routes.
- `infra/supabase/migrations`: Supabase schema, RLS, and hosted pipeline tables.
- `config/rss-sources.json`: RSS source list used by the hosted pipeline.
- `vercel.json`: Vercel build settings and cron schedule.

The reader keeps only the latest published feed in `news_items`. Pipeline memory remains in `articles`, `story_clusters`, `digest_runs`, and stage tables.

## Requirements

- Node.js `>=20.9.0`
- pnpm `>=10.30.1`
- Supabase project with Auth enabled
- Vercel project connected to this GitHub repo

## Environment

Copy the example:

```bash
cp .env.example .env
```

Required variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_READER_EMAILS=you@example.com
INGEST_SECRET=replace-with-long-random-secret
CRON_SECRET=replace-with-long-random-cron-secret
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET`, and `CRON_SECRET` must stay server-side.
- `ALLOWED_READER_EMAILS` is a comma-separated login allowlist.
- Set `NEXT_PUBLIC_APP_URL` to the Vercel production URL after deploy.

## Supabase Setup

Run migrations in order:

```text
infra/supabase/migrations/001_reader_schema.sql
infra/supabase/migrations/003_harden_reader_functions.sql
infra/supabase/migrations/004_move_reader_allowlist_private.sql
infra/supabase/migrations/005_hosted_pipeline_schema.sql
```

Then insert your reader email into `private.allowed_reader_emails` and create a Supabase Auth user for that email.

Add callback URLs in Supabase Auth settings:

```text
http://127.0.0.1:3000/auth/callback
https://your-vercel-domain.vercel.app/auth/callback
```

## Local Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev:reader
```

Or run the reader through Docker Compose:

```bash
docker compose up --build reader
```

Open:

```text
http://127.0.0.1:3000
```

## Validation

```bash
pnpm typecheck
pnpm build
```

The Vercel build uses:

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm build:reader"
}
```

## Vercel Deployment

1. Import the GitHub repo into Vercel.
2. Use the repository root containing `vercel.json`.
3. Set the environment variables listed above.
4. Deploy from `main`.

Vercel Cron invokes:

```text
GET /api/digest-runs/advance
```

The route requires:

```text
Authorization: Bearer $CRON_SECRET
```

The configured schedule is once per minute:

```json
"* * * * *"
```

If your Vercel plan does not support once-per-minute cron, change the schedule in `vercel.json` to the shortest supported interval.

## Operations

Start a digest from the reader UI with `Run digest`. The UI only creates/observes runs; Vercel Cron advances the pipeline.

Sanitize existing stored text after changing HTML cleanup logic:

```bash
pnpm --dir apps/reader cleanup:text
```

Only run that command against the Supabase project you intend to mutate.
