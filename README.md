# Daily News Digest

Daily News Digest is a private news system that runs the automation pipeline locally and keeps the reader experience small, authenticated, and mobile-friendly.

The current version has four main parts:

- `n8n` runs the scheduled automation and exposes the latest Markdown digest through a private webhook.
- `digest-builder` is a local Python HTTP service that fetches RSS, clusters stories, enriches top candidates, scores them, and writes Markdown output.
- local PostgreSQL stores pipeline memory, story history, enriched article text, and run metadata.
- `apps/reader` is a private Next.js reader app using Supabase Auth and Supabase Postgres for reader-facing items and per-user read/save/archive state.

The repository is a product monorepo. n8n is one subsystem, not the whole app.

## Current Architecture

```text
Local Docker runtime:
  n8n
  digest-builder
  local PostgreSQL
  reader app at http://127.0.0.1:3000

External services:
  Supabase Auth
  Supabase Postgres
  NVIDIA NIM API, optional but recommended for AI editorial review

Data flow:
  RSS feeds -> digest-builder -> local PostgreSQL -> Markdown files
  Markdown files -> n8n webhook -> Apple Shortcuts or manual readers
  selected reader items -> /api/ingest -> Supabase -> Next.js reader UI
```

The exported n8n build workflow currently writes Markdown files. The reader ingest endpoint and contract are implemented, but the exported build workflow does not yet push selected items into `/api/ingest` by default. See [docs/ingest-contract.md](docs/ingest-contract.md) before wiring that step.

## Repository Layout

```text
daily-news-digest/
  apps/
    reader/                    # Next.js private reader, shadcn/ui, Supabase Auth
  config/
    editorial-settings.json    # ranking, scoring, enrichment, AI review settings
    rss-sources.json           # RSS source list
  docs/
    ingest-contract.md
    project-structure.md
  infra/
    supabase/migrations/       # reader database schema and RLS
  prompts/
    ai-editorial-review.md
    nvidia-news-editor.md
  scripts/
    build_digest.py
    digest_service.py
    digest_store.py
  storage/
    digests/                   # latest.md and archive output
  workflows/
    daily-news-digest-build.json
    daily-news-digest-get-latest.json
  docker-compose.yml
  Dockerfile.digest-builder
  Dockerfile.reader
  package.json
  pnpm-workspace.yaml
```

## Requirements

- Docker Desktop or Docker Engine with Docker Compose
- Node.js `>=20.9.0`
- pnpm `>=10.30.1`
- a Supabase project for the reader database and auth
- an NVIDIA API key if AI editorial review should run
- optional: Tailscale for private access to n8n webhooks from iPhone or Mac

## Environment Variables

Copy the example file first:

```bash
cp .env.example .env
```

### Local Stack

```env
POSTGRES_USER=n8n
POSTGRES_PASSWORD=change-me
POSTGRES_DB=n8n
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
N8N_ENCRYPTION_KEY=replace-with-openssl-output
GENERIC_TIMEZONE=Europe/Warsaw
TZ=Europe/Warsaw
```

Generate `N8N_ENCRYPTION_KEY` with:

```bash
openssl rand -hex 32
```

Keep this value stable after n8n has stored credentials. Rotating it casually can make existing n8n credentials unreadable.

### NVIDIA

```env
NVIDIA_API_KEY=replace-with-your-nvidia-api-key
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_NIM_FALLBACK_MODEL=nvidia/nvidia-nemotron-nano-9b-v2
AI_DEDUPE_ENABLED=true
ENRICH_TOP_N=12
```

If `NVIDIA_API_KEY` is empty or the API call fails, the digest builder falls back to the heuristic scoring path.

### Reader And Supabase

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_READER_EMAILS=you@example.com
INGEST_SECRET=replace-with-long-random-secret
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
```

Get these values from Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project settings, API URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase project API keys, anon/publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase project API keys, service role key. Keep it server-side only.
- `ALLOWED_READER_EMAILS`: comma-separated email allowlist for reader login.
- `INGEST_SECRET`: generate locally with `openssl rand -hex 32`.

The reader login page shows the missing variable names if the runtime config is incomplete.

## Supabase Setup

1. Create a Supabase project.
2. In Supabase SQL editor, run the migrations in order:

```text
infra/supabase/migrations/001_reader_schema.sql
infra/supabase/migrations/003_harden_reader_functions.sql
infra/supabase/migrations/004_move_reader_allowlist_private.sql
```

3. Insert your reader email into the private allowlist. Start from:

```text
infra/supabase/migrations/002_insert_allowed_reader_email.sql.example
```

4. In Supabase Auth providers, keep email/password sign-in enabled.
5. Create a Supabase Auth user for your allowlisted email and set a password. In the dashboard, use `Authentication` -> `Users` -> `Add user`; confirm the email there so local sign-in does not depend on delivery emails.
6. In Supabase Auth URL configuration, add the local callback URL:

```text
http://127.0.0.1:3000/auth/callback
```

If you deploy the reader later, add the deployed callback URL too:

```text
https://your-reader-domain/auth/callback
```

## Install And Validate The Reader Locally

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck:reader
pnpm build:reader
```

Notes:

- The reader uses Next.js standalone output for Docker.
- `pnpm lint:reader` is currently not a reliable command because the installed Next CLI no longer supports `next lint` as configured.
- In restricted sandboxes, `pnpm build:reader` may fail if Turbopack cannot bind its internal worker port. Running the build normally on the host or in Docker works.

## Start The Stack

```bash
docker compose up -d
```

Rebuild after changing Dockerfiles, dependencies, or reader source:

```bash
docker compose up --build -d
```

Check containers:

```bash
docker compose ps
```

Expected services:

- `daily-news-digest-postgres`
- `daily-news-digest-n8n`
- `daily-news-digest-builder`
- `daily-news-digest-reader`

Open the apps:

```text
n8n editor:  http://127.0.0.1:5678
reader app:  http://127.0.0.1:3000
```

Both ports are bound to `127.0.0.1`. The reader container also runs as a non-root user with a read-only runtime filesystem, dropped Linux capabilities, and `no-new-privileges`.

## Import n8n Workflows

Import both workflow exports from n8n:

```text
workflows/daily-news-digest-build.json
workflows/daily-news-digest-get-latest.json
```

Recommended order:

1. Import `Daily News Digest - Build`.
2. Run it manually once.
3. Confirm it writes `storage/digests/latest.md`.
4. Import `Daily News Digest - Get Latest`.
5. Activate the webhook workflow after the first digest exists.

## How The Build Workflow Works

`Daily News Digest - Build` runs daily at `07:00` in `Europe/Warsaw`.

It sends this payload to the Python service:

```text
POST http://digest-builder:8000/build
```

The Python service:

- loads RSS sources from `config/rss-sources.json`
- loads scoring and AI settings from `config/editorial-settings.json`
- fetches RSS items and normalizes URLs
- clusters related articles into stories
- compares current stories against local PostgreSQL history
- computes impact, novelty, confirmation, scope fit, and urgency
- enriches top stories with article text where possible
- optionally runs the NVIDIA-backed editorial review pass
- persists run/story/article metadata to local PostgreSQL
- writes Markdown output to `storage/digests/latest.md` and `storage/digests/archive/YYYY-MM-DD.md`

## How The Latest Digest Webhook Works

`Daily News Digest - Get Latest` handles:

```text
GET /webhook/daily-news-digest
```

It reads:

```text
storage/digests/latest.md
```

and returns it as:

```text
text/markdown; charset=utf-8
```

Local test:

```bash
curl http://127.0.0.1:5678/webhook/daily-news-digest
```

This webhook is convenient for Apple Shortcuts, but it has no app-level auth in the exported workflow. Keep it private behind localhost or Tailscale, or add a token check before exposing it more broadly.

## Reader App

The reader is a private Next.js app in `apps/reader`.

Current reader features:

- email/password login through Supabase Auth
- email allowlist check
- feed of reader-facing news items
- article detail page
- read/unread toggle
- saved/bookmarked toggle
- archive/hide toggle
- mobile-first shadcn/ui interface
- protected ingest route at `POST /api/ingest`

The reader uses Supabase for:

- `news_items`
- `reader_item_states`
- auth sessions
- private allowed-reader email checks through RLS helper functions

The ingest route is documented in [docs/ingest-contract.md](docs/ingest-contract.md).

## Testing Checklist

### Local Services

```bash
docker compose ps
```

### NVIDIA API

Load local environment variables:

```bash
set -a
source .env
set +a
```

Call the chat completion endpoint:

```bash
curl https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta/llama-3.3-70b-instruct",
    "messages": [
      {
        "role": "user",
        "content": "Write a one-sentence summary in Polish: NVIDIA NIM can be used as an OpenAI-compatible API."
      }
    ],
    "temperature": 0.2,
    "max_tokens": 200
  }'
```

### Build Workflow

1. Open `http://127.0.0.1:5678`.
2. Run `Daily News Digest - Build` manually.
3. Confirm `Write Latest Digest` and `Write Archive Digest` succeeded.
4. Check `storage/digests/latest.md`.

### Latest Digest Webhook

```bash
curl http://127.0.0.1:5678/webhook/daily-news-digest
```

### Reader

1. Open `http://127.0.0.1:3000`.
2. If config is missing, fill the listed `.env` variables and restart the reader.
3. Sign in with an email that exists in `private.allowed_reader_emails`.
4. Verify the feed loads.

If the feed is empty, the Supabase reader database has no ingested `news_items` yet. Use the ingest contract to push items from n8n or a test client.

## Tailscale Setup For Private Webhook Access

Tailscale is only needed if another device should call the local n8n webhook.

1. Sign in to Tailscale on the Docker host.
2. Make sure the iPhone or Mac is in the same tailnet.
3. Serve local n8n through Tailscale:

```bash
tailscale serve --bg http://127.0.0.1:5678
```

4. Check the URL:

```bash
tailscale serve status
```

Optional `.env` values for generated n8n URLs:

```env
N8N_HOST=your-device-name.your-tailnet.ts.net
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://your-device-name.your-tailnet.ts.net
WEBHOOK_URL=https://your-device-name.your-tailnet.ts.net/
```

Restart after changing those values:

```bash
docker compose down
docker compose up -d
```

Security rules:

- Do not use Tailscale Funnel for the n8n editor.
- Do not expose port `5678` through a public router or public reverse proxy.
- Add webhook authentication before exposing `/webhook/daily-news-digest` outside a trusted tailnet.

## Apple Shortcuts

Use the Tailscale webhook URL, not `127.0.0.1`, from iPhone:

```text
https://your-device.your-tailnet.ts.net/webhook/daily-news-digest
```

### Save Daily News Digest

1. Create a shortcut named `Save Daily News Digest`.
2. Add `Get Contents of URL`.
3. Set method `GET`.
4. Paste the Tailscale webhook URL.
5. Add `Current Date`.
6. Add `Format Date` with custom format `yyyy-MM-dd`.
7. Add `Create Note`.
8. Use title `News Digest - [Formatted Date]`.
9. Use the result of `Get Contents of URL` as the note body.

### Fetch Daily News Digest

1. Create a shortcut named `Fetch Daily News Digest`.
2. Add `Get Contents of URL`.
3. Set method `GET`.
4. Paste the Tailscale webhook URL.
5. Add `Quick Look` or `Show Result`.

## Tuning Sources And Scoring

Change RSS sources in:

```text
config/rss-sources.json
```

Change ranking, enrichment, and AI review settings in:

```text
config/editorial-settings.json
```

Change the editable AI review prompt in:

```text
prompts/ai-editorial-review.md
```

After config-only changes:

```bash
docker compose up -d
```

After dependency or image changes:

```bash
docker compose up --build -d
```

## Security Notes

- Keep secrets in `.env`; it is ignored by git.
- `SUPABASE_SERVICE_ROLE_KEY` must stay server-side only.
- n8n is bound to localhost by default.
- the reader is bound to localhost in Docker Compose by default.
- the latest digest webhook has no built-in auth in the exported workflow.
- the digest-builder service is internal to the Compose network; do not publish it publicly.
- production dependency audit is available with `pnpm audit:prod`.

## Useful Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck:reader
pnpm build:reader
pnpm audit:prod

docker compose up -d
docker compose up --build -d
docker compose logs -f reader
docker compose logs -f digest-builder
docker compose down
```

## Related Docs

- [docs/project-structure.md](docs/project-structure.md)
- [docs/ingest-contract.md](docs/ingest-contract.md)
