ALTER TABLE public.source_items
  ADD COLUMN IF NOT EXISTS reader_source_id UUID REFERENCES public.reader_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS source_items_reader_source_run_idx
  ON public.source_items (reader_source_id, digest_run_id)
  WHERE reader_source_id IS NOT NULL;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS content_mode_reason TEXT,
  ADD COLUMN IF NOT EXISTS has_audio BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_video BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.articles
  DROP CONSTRAINT IF EXISTS articles_content_mode_check;

ALTER TABLE public.articles
  ADD CONSTRAINT articles_content_mode_check CHECK (
    content_mode IN ('unknown', 'readable', 'audio_only', 'video_only', 'insufficient_text')
  );

CREATE INDEX IF NOT EXISTS articles_content_mode_last_seen_idx
  ON public.articles (content_mode, last_seen_at DESC NULLS LAST);

ALTER TABLE public.reader_digest_settings
  ADD COLUMN IF NOT EXISTS readable_only BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS personalization_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS implicit_personalization_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.reader_digest_settings.readable_only IS
  'When enabled, only stories with a full written article variant can be selected.';
COMMENT ON COLUMN public.reader_digest_settings.personalization_enabled IS
  'Applies explicit More/Less feedback to Digest Builder and Reader ranking.';
COMMENT ON COLUMN public.reader_digest_settings.implicit_personalization_enabled IS
  'Uses deduplicated positive reading events after the cold-start evidence threshold is met.';

CREATE TABLE IF NOT EXISTS public.story_cluster_articles (
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  first_seen_digest_run_id UUID REFERENCES public.digest_runs(id) ON DELETE SET NULL,
  last_seen_digest_run_id UUID REFERENCES public.digest_runs(id) ON DELETE SET NULL,
  match_reason TEXT NOT NULL DEFAULT 'new_story',
  match_score DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (match_score BETWEEN 0 AND 1),
  algorithm_version TEXT NOT NULL DEFAULT 'story-clustering-v2',
  is_canonical BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_cluster_id, article_id)
);

CREATE INDEX IF NOT EXISTS story_cluster_articles_article_idx
  ON public.story_cluster_articles (article_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS story_cluster_articles_cluster_seen_idx
  ON public.story_cluster_articles (story_cluster_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS story_cluster_articles_first_run_idx
  ON public.story_cluster_articles (first_seen_digest_run_id)
  WHERE first_seen_digest_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS story_cluster_articles_last_run_idx
  ON public.story_cluster_articles (last_seen_digest_run_id)
  WHERE last_seen_digest_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS story_cluster_articles_one_canonical_idx
  ON public.story_cluster_articles (story_cluster_id)
  WHERE is_canonical;

CREATE TABLE IF NOT EXISTS public.source_run_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  reader_source_id UUID REFERENCES public.reader_sources(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error_kind TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  parsed_item_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_item_count >= 0),
  eligible_item_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_item_count >= 0),
  skipped_old_item_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_old_item_count >= 0),
  skipped_undated_item_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_undated_item_count >= 0),
  unique_story_count INTEGER NOT NULL DEFAULT 0 CHECK (unique_story_count >= 0),
  selected_story_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_story_count >= 0),
  confirmation_story_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_story_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_run_id, source_url)
);

CREATE INDEX IF NOT EXISTS source_run_observations_source_created_idx
  ON public.source_run_observations (source_url, created_at DESC);

CREATE INDEX IF NOT EXISTS source_run_observations_reader_source_idx
  ON public.source_run_observations (reader_source_id, created_at DESC)
  WHERE reader_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_run_observations_status_created_idx
  ON public.source_run_observations (status, created_at DESC);

DROP TRIGGER IF EXISTS set_source_run_observations_updated_at ON public.source_run_observations;
CREATE TRIGGER set_source_run_observations_updated_at
BEFORE UPDATE ON public.source_run_observations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.story_cluster_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_run_observations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.story_cluster_articles FROM anon, authenticated;
REVOKE ALL ON public.source_run_observations FROM anon, authenticated;

GRANT ALL ON public.story_cluster_articles TO service_role;
GRANT ALL ON public.source_run_observations TO service_role;

GRANT SELECT ON public.source_run_observations TO authenticated;

DROP POLICY IF EXISTS "Allowed readers can view source quality" ON public.source_run_observations;
CREATE POLICY "Allowed readers can view source quality"
ON public.source_run_observations
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()));
