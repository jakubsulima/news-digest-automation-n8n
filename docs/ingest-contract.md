# Reader Ingest Contract

The reader app receives selected digest items from n8n through a protected Next.js API route.

```text
POST https://daily-news-digest-reader.vercel.app/api/ingest
Authorization: Bearer <INGEST_SECRET>
Content-Type: application/json
```

The hosted app must never call local n8n directly. The data flow is one-way outbound from the local machine:

```text
n8n / digest-builder -> Next.js /api/ingest -> Supabase -> reader UI
```

## Payload

The endpoint accepts either a single item or a batch.

### Batch

```json
{
  "items": [
    {
      "externalId": "2026-06-14:https://example.com/story",
      "digestDate": "2026-06-14",
      "title": "Story headline",
      "summary": "Short reader-facing summary.",
      "source": "Example News",
      "sourceUrl": "https://example.com/story",
      "category": "ai",
      "importanceScore": 78,
      "publishedAt": "2026-06-14T06:15:00Z"
    }
  ]
}
```

### Single Item

```json
{
  "externalId": "2026-06-14:https://example.com/story",
  "digestDate": "2026-06-14",
  "title": "Story headline",
  "summary": "Short reader-facing summary.",
  "source": "Example News",
  "sourceUrl": "https://example.com/story",
  "category": "ai",
  "importanceScore": 78,
  "publishedAt": "2026-06-14T06:15:00Z"
}
```

## Field Rules

```text
externalId       required, stable unique id for upsert
digestDate       required, YYYY-MM-DD
title            required
summary          required
source           required
sourceUrl        required, URL
category         required
importanceScore  optional integer from 0 to 100
publishedAt      optional ISO datetime
```

`externalId` should be deterministic. A good default is:

```text
{digestDate}:{canonicalUrl}
```

## Response

Success:

```json
{
  "ok": true,
  "inserted": 12
}
```

Authentication failure:

```json
{
  "ok": false,
  "error": "Unauthorized"
}
```

Validation failure:

```json
{
  "ok": false,
  "error": "Invalid payload",
  "details": []
}
```
