ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'limited'
    CHECK (evidence_status IN ('full_text', 'corroborated_summary', 'limited')),
  ADD COLUMN IF NOT EXISTS evidence_details JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS news_items_evidence_status_idx
  ON public.news_items (evidence_status, digest_date DESC);

CREATE TABLE IF NOT EXISTS public.digest_summary_localizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_summary_id UUID NOT NULL REFERENCES public.digest_summaries(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('pl', 'en')),
  summary TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  watchlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_note TEXT NOT NULL DEFAULT '',
  reading_time_minutes INTEGER NOT NULL DEFAULT 1 CHECK (reading_time_minutes BETWEEN 1 AND 60),
  generation_mode TEXT NOT NULL DEFAULT 'fallback',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_summary_id, locale),
  CHECK (jsonb_typeof(sections) = 'array'),
  CHECK (jsonb_typeof(watchlist) = 'array'),
  CHECK (jsonb_typeof(highlights) = 'array')
);

CREATE INDEX IF NOT EXISTS digest_summary_localizations_lookup_idx
  ON public.digest_summary_localizations (digest_summary_id, locale);

CREATE TABLE IF NOT EXISTS public.news_item_localizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  news_item_id UUID NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('pl', 'en')),
  summary TEXT NOT NULL,
  preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  why_it_matters TEXT,
  recommended_action TEXT,
  generation_mode TEXT NOT NULL DEFAULT 'fallback',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (news_item_id, locale),
  CHECK (jsonb_typeof(preview) = 'object')
);

CREATE INDEX IF NOT EXISTS news_item_localizations_lookup_idx
  ON public.news_item_localizations (news_item_id, locale);

DROP TRIGGER IF EXISTS set_digest_summary_localizations_updated_at ON public.digest_summary_localizations;
CREATE TRIGGER set_digest_summary_localizations_updated_at
BEFORE UPDATE ON public.digest_summary_localizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_news_item_localizations_updated_at ON public.news_item_localizations;
CREATE TRIGGER set_news_item_localizations_updated_at
BEFORE UPDATE ON public.news_item_localizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.digest_summary_localizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_item_localizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allowed readers can view digest localizations" ON public.digest_summary_localizations;
CREATE POLICY "Allowed readers can view digest localizations"
ON public.digest_summary_localizations
FOR SELECT TO authenticated
USING ((SELECT private.is_allowed_reader()));

DROP POLICY IF EXISTS "Allowed readers can view news localizations" ON public.news_item_localizations;
CREATE POLICY "Allowed readers can view news localizations"
ON public.news_item_localizations
FOR SELECT TO authenticated
USING ((SELECT private.is_allowed_reader()));

GRANT SELECT ON public.digest_summary_localizations, public.news_item_localizations TO authenticated;
GRANT ALL ON public.digest_summary_localizations, public.news_item_localizations TO service_role;

ALTER TABLE public.reader_notes
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(note_text, '') || ' ' ||
      coalesce(quote_text, '') || ' ' ||
      coalesce(title_snapshot, '') || ' ' ||
      coalesce(source_snapshot, '') || ' ' ||
      coalesce(topic_tags_snapshot::text, '') || ' ' ||
      coalesce(entity_tags_snapshot::text, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS reader_notes_search_vector_idx
  ON public.reader_notes USING GIN (search_vector);
