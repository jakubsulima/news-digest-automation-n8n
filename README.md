# Daily News Digest

A simple local n8n-based MVP that:

- fetches news from RSS every morning
- clusters articles into story clusters
- enriches top stories with text fetched from destination pages
- stores run history, story state, and enriched article text in PostgreSQL
- generates a Polish Markdown digest focused on what is new in the last day
- writes the latest digest to a local file
- exposes it through a private n8n webhook
- lets you save it to Apple Notes through Apple Shortcuts

The project is intentionally simple. It does not rely on full-page scraping, it does not expose the n8n editor publicly, and it can be set up locally in one evening.

## Architecture

1. Docker Compose runs `n8n`, `PostgreSQL`, and the local Python `digest-builder` service.
2. The `Daily News Digest - Build` workflow calls the Python service.
3. The Python service:
   - fetches RSS feeds
   - normalizes URLs
   - clusters similar stories
   - compares them with recent history in PostgreSQL
   - scores them heuristically
   - enriches top candidates with article page text
   - optionally runs an AI editorial review pass
   - renders the final digest
4. The digest is written to:
   - `storage/digests/latest.md`
   - `storage/digests/archive/YYYY-MM-DD.md`
5. The `Daily News Digest - Get Latest` workflow returns `latest.md` over a GET webhook.
6. Apple Shortcuts can fetch that webhook over Tailscale and save the result to Apple Notes.

## Why Keep a Local File

The digest is still delivered as a local file, but it is no longer the only state in the system.

- `latest.md` and the Markdown archive are convenient for reading and backup.
- PostgreSQL stores cross-run story memory, which makes novelty, confirmation, and “what changed since yesterday” possible.
- Enriched article text stays in the database, so you can debug ranking decisions or rebuild summaries without fetching pages again.

This keeps delivery simple while adding the state layer needed for a useful coverage-first digest.

## Project Structure

```text
daily-news-digest/
  docker-compose.yml
  .env.example
  .gitignore
  Dockerfile.digest-builder
  README.md
  workflows/
    daily-news-digest-build.json
    daily-news-digest-get-latest.json
  config/
    rss-sources.json
    editorial-settings.json
  prompts/
    ai-editorial-review.md
    nvidia-news-editor.md
  scripts/
    build_digest.py
    digest_service.py
    digest_store.py
  storage/
    digests/
      latest.md
      archive/
```

## Requirements

- Docker Desktop or Docker Engine with Docker Compose
- a Tailscale account and client on the machine running n8n
- a Tailscale account on the iPhone and/or Mac that will call the webhook
- an `NVIDIA_API_KEY` for NVIDIA Build / NIM
- basic comfort with terminal commands

## Step-by-Step Setup

### 1. Enter the project directory

```bash
cd /Users/jakub/Desktop/n8n/daily-news-digest
```

### 2. Copy `.env.example` to `.env`

```bash
cp .env.example .env
```

### 3. Generate `N8N_ENCRYPTION_KEY`

```bash
openssl rand -hex 32
```

Paste the output into `.env`:

```env
N8N_ENCRYPTION_KEY=paste-the-value-here
```

This must stay stable. Do not rotate it casually after the system is already running, or you may break stored credentials and data in n8n.

### 4. Set PostgreSQL values in `.env`

Example:

```env
POSTGRES_USER=n8n
POSTGRES_PASSWORD=replace-me-with-a-strong-password
POSTGRES_DB=n8n
```

### 5. Set `NVIDIA_API_KEY`

In `.env`:

```env
NVIDIA_API_KEY=paste-your-key-here
```

Defaults are already provided:

```env
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_NIM_FALLBACK_MODEL=nvidia/nvidia-nemotron-nano-9b-v2
ENRICH_TOP_N=12
```

### 6. Start the stack

```bash
docker compose up -d
```

If you changed the builder image or dependencies, rebuild:

```bash
docker compose up --build -d
```

### 7. Verify containers

```bash
docker compose ps
```

You should see `postgres`, `n8n`, and `digest-builder` running.

### 8. Open n8n

```text
http://127.0.0.1:5678
```

The editor is intentionally only exposed locally.

## Test the NVIDIA API with curl

Before importing workflows, it is worth checking that the key works.

Load the `.env` variables into your current shell:

```bash
set -a
source .env
set +a
```

Then run:

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

If it works, you should get JSON with `choices[0].message.content`.

## Tailscale Setup

Goal: private access to n8n and webhooks without exposing the service publicly.

### 1. Sign in to Tailscale on the n8n machine

Make sure the Docker host is in the same tailnet as your iPhone and/or Mac.

### 2. Expose local n8n through Tailscale Serve

```bash
tailscale serve --bg http://127.0.0.1:5678
```

### 3. Check status

```bash
tailscale serve status
```

You will get the device URL in your tailnet. Use that URL in Shortcuts.

### 4. Optionally set proper external URLs in `.env`

If you want n8n to generate webhook URLs with the Tailscale hostname:

```env
N8N_HOST=your-device.your-tailnet.ts.net
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://your-device.your-tailnet.ts.net
WEBHOOK_URL=https://your-device.your-tailnet.ts.net/
```

Then restart:

```bash
docker compose down
docker compose up -d
```

### 5. Security rules

- Do not use Tailscale Funnel for the n8n editor.
- Do not expose port `5678` publicly through your router or reverse proxy.
- All client devices must be in the same tailnet.
- Keep secrets only in `.env`.

## Import the Workflows

### Workflow 1: `Daily News Digest - Build`

1. Open n8n.
2. Go to `Workflows`.
3. Click `Import from File`.
4. Select:

```text
workflows/daily-news-digest-build.json
```

5. Save the workflow.
6. Run it manually once before activating it.

### Workflow 2: `Daily News Digest - Get Latest`

1. Click `Import from File`.
2. Select:

```text
workflows/daily-news-digest-get-latest.json
```

3. Save the workflow.
4. Activate it after the first digest has been generated.

## How `Daily News Digest - Build` Works

1. `Schedule Trigger` runs every day at `07:00` in `Europe/Warsaw`.
2. `RSS Sources Config` sends the Python service:
   - the RSS config path
   - the maximum number of articles
   - the AI dedupe flag
3. `Build Digest In Python` calls `http://digest-builder:8000/build`.
4. The Python service:
   - fetches RSS feeds
   - normalizes URLs and drops stale items
   - merges similar articles into story clusters
   - compares them with recent history in PostgreSQL
   - computes `impact`, `novelty`, `confirmation`, `scope_fit`, and `urgency`
   - enriches top stories with article page text
   - optionally runs AI editorial review
   - stores run, story, and article metadata in PostgreSQL
5. n8n writes the final digest to:
   - `storage/digests/latest.md`
   - `storage/digests/archive/YYYY-MM-DD.md`

## Tune Weights Without Changing Code

The file:

```text
config/editorial-settings.json
```

controls:

- final weights for `impact / novelty / confirmation / scope_fit / urgency`
- keyword weights
- generic war story penalties
- story matching thresholds
- the default enrichment top-N
- AI editorial review settings

After changing only this file, a normal restart is enough:

```bash
docker compose up -d
```

If you also changed the image or dependencies:

```bash
docker compose up --build -d
```

## AI Editorial Review

After heuristic ranking, the system can run a second model-based review pass.

Pipeline:

1. heuristics and clustering produce candidates
2. enrichment fetches text for top stories
3. AI reviews the shortlist and returns JSON with:
   - `keep`
   - `editorialAdjustment`
   - `importance`
   - `scopeFit`
   - `warRelevance`
   - `reason`
4. the final rank is the heuristic score plus AI bonus or penalty

The settings live in:

```text
config/editorial-settings.json
```

In the `ai_editorial_review` section.

If `NVIDIA_API_KEY` is missing or the API fails, the workflow falls back to heuristics only.

The editable prompt for this pass is here:

```text
prompts/ai-editorial-review.md
```

## How `Daily News Digest - Get Latest` Works

1. `Webhook` handles `GET` on:

```text
/daily-news-digest
```

2. `Read Latest Digest File` reads `storage/digests/latest.md`.
3. `Binary To Text` converts the file to text.
4. `Respond To Webhook` returns the digest as `text/markdown`.

This is convenient for Apple Shortcuts because the shortcut gets clean text, not extra JSON.

## Environment Variables in n8n

In this MVP you do not create a separate NVIDIA credential in n8n.

- `NVIDIA_API_KEY` is passed into the container through Docker Compose.
- the HTTP call path reads it through the environment.
- after changing `.env`, restart the stack:

```bash
docker compose down
docker compose up -d
```

## Testing Checklist

### 1. Verify n8n loads

1. Open `http://127.0.0.1:5678`.
2. Make sure the editor loads.

### 2. Verify the NVIDIA API works

1. Run the curl test above.
2. Confirm you receive `choices[0].message.content`.

### 3. Verify the Build workflow creates a digest

1. Open `Daily News Digest - Build`.
2. Click `Execute workflow`.
3. Wait for the run to finish.
4. Confirm `Write Latest Digest` succeeded.
5. Check:

```text
storage/digests/latest.md
```

### 4. Verify the webhook returns the digest

1. Open `Daily News Digest - Get Latest`.
2. Activate it.
3. Call the webhook:

```bash
curl http://127.0.0.1:5678/webhook/daily-news-digest
```

If you use Tailscale Serve, use the Tailscale URL instead.

### 5. Verify Apple Shortcut creates a note

1. Configure the shortcut using the instructions below.
2. Run it on an iPhone or Mac connected to the tailnet.
3. Check Apple Notes for the new note.

## Apple Shortcut: Save Daily News Digest

Goal: fetch the latest digest and create a new Apple Note from it.

### Webhook URL

With Tailscale Serve, the webhook will usually look like:

```text
https://your-device.your-tailnet.ts.net/webhook/daily-news-digest
```

Do not use `127.0.0.1` on iPhone.

### iPhone setup

1. Open `Shortcuts`.
2. Tap `+`.
3. Name it `Save Daily News Digest`.
4. Add `Get Contents of URL`.
5. Set:
   - URL: the n8n webhook URL through Tailscale
   - Method: `GET`
6. Add `Current Date`.
7. Add `Format Date`.
8. Choose `Custom`.
9. Use:

```text
yyyy-MM-dd
```

10. Add `Create Note`.
11. Set the note title to:

```text
News Digest - [Formatted Date]
```

12. Set the note body to the result of `Get Contents of URL`.
13. If available, choose the `News Digest` folder.
14. If the folder does not exist, create it manually in Apple Notes first.
15. Save the shortcut.
16. Run it once as a test.

### Mac setup

1. Open `Shortcuts`.
2. Click `+`.
3. Name it `Save Daily News Digest`.
4. Add `Get Contents of URL`.
5. Set method `GET`.
6. Paste the Tailscale webhook URL.
7. Add `Current Date`.
8. Add `Format Date` with `yyyy-MM-dd`.
9. Add `Create Note`.
10. Title:

```text
News Digest - [Formatted Date]
```

11. Body:

```text
[Get Contents of URL]
```

12. If folder selection is available, choose `News Digest`.
13. Save and run it.

## Apple Shortcut: Fetch Daily News Digest

A simpler version without saving to Notes.

### iPhone or Mac

1. Create a new shortcut named `Fetch Daily News Digest`.
2. Add `Get Contents of URL`.
3. Set method `GET`.
4. Paste the webhook URL.
5. Add `Quick Look` or `Show Result`.
6. Save the shortcut.

When you run it, the digest will be displayed on screen.

## Future Enhancement: Summarize This Link

Not implemented here yet, but it is a good next step.

Idea:

1. The shortcut runs from the Share Sheet.
2. It receives the current URL.
3. It sends the URL to an n8n webhook.
4. n8n fetches metadata or page content.
5. NVIDIA NIM produces a summary.
6. The result is saved to Apple Notes or shown immediately.

## Example RSS Sources

The MVP includes neutral example sources:

- AI: `https://venturebeat.com/category/ai/feed/`
- Apple / Tech: `https://9to5mac.com/feed/`
- productivity: `https://zapier.com/blog/rss.xml`
- cybersecurity: `https://thehackernews.com/feeds/posts/default`
- dev tools: `https://stackoverflow.blog/feed/`
- tech jobs: `https://weworkremotely.com/categories/remote-programming-jobs.rss`

You can replace them by editing the configured sources or workflow inputs.

## Change RSS Sources

1. Open `Daily News Digest - Build`.
2. Edit the relevant RSS source definition.
3. Save the workflow.
4. Run `Execute workflow` as a test.

Do not start with too many sources. `5-8` feeds is still a good MVP-sized range.

## Change Interests in the Prompt

You have two options:

1. Simple:
   - edit the prompt directly where it is used
2. Cleaner:
   - treat `prompts/nvidia-news-editor.md` as the source of truth
   - copy changes into the relevant request path if you use that prompt downstream

## Change the NVIDIA Model

Update `.env`:

```env
NVIDIA_NIM_MODEL=your-model
NVIDIA_NIM_FALLBACK_MODEL=your-fallback
```

Then restart:

```bash
docker compose down
docker compose up -d
```

## Disable AI and Fall Back to Basic Output

You have two simple options:

1. Route directly to a basic digest path.
2. Temporarily set a bad model or empty `NVIDIA_API_KEY` so the AI path is skipped or fails over.

The first option is cleaner.

## Troubleshooting

### NVIDIA API returns 401

Most common causes:

- wrong `NVIDIA_API_KEY`
- extra spaces or quotes in `.env`
- the container was not restarted after editing `.env`

### NVIDIA API returns 404 or model errors

Most common causes:

- invalid model name
- the model is not available for your account

Check:

```env
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_NIM_FALLBACK_MODEL=nvidia/nvidia-nemotron-nano-9b-v2
```

### NVIDIA API returns 429 or quota errors

Usually rate limiting or quota.

Try:

- waiting a few minutes
- reducing test frequency
- testing the fallback model
- temporarily using a non-AI mode

### RSS returns too little data or errors

Not every feed is reliable. Some feeds:

- expose only a subset of posts
- block requests
- respond inconsistently

For an MVP, just replace unstable feeds.

### Webhook does not work on iPhone

Check:

- that iPhone is signed in to Tailscale
- that the host machine is online
- that `tailscale serve status` shows an active mapping
- that `Daily News Digest - Get Latest` is active

### `latest.md` does not exist

Run `Daily News Digest - Build` manually first. Only then test `Get Latest`.

## Debugging the AI Path

If AI is not working:

1. Open the latest workflow execution.
2. Inspect the builder call path and any relevant HTTP node output.
3. Check:
   - HTTP status
   - error body
   - whether the authorization token is actually present
4. If the primary path fails, verify fallback behavior.

The system is designed to keep producing a digest even when AI is unavailable.

## Backup

For an MVP, three layers are enough:

- Apple Notes keeps user-facing copies of daily digests
- `storage/digests/archive/` keeps a local Markdown archive
- Docker volumes keep n8n and PostgreSQL state

For a quick project backup, copy:

- the whole project directory
- Docker volumes or Docker exports

## Update n8n

1. Stop the stack:

```bash
docker compose down
```

2. Pull newer images:

```bash
docker compose pull
```

3. Start again:

```bash
docker compose up -d
```

4. Open n8n and verify that workflows still import and execute correctly.

## Possible Future Extensions

Good next steps:

- email newsletters as additional sources
- a `Summarize This Link` shortcut from the Apple Share Sheet
- better pre-AI scoring
- separate digests for AI, Apple, and jobs
- a digest history dashboard
- automatic note tagging
- delivery to Telegram or email
