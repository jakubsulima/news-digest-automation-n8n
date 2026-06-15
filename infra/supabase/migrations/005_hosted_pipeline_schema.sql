CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.digest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  started_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS digest_runs_one_active_idx
  ON public.digest_runs ((TRUE))
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS digest_runs_report_date_idx
  ON public.digest_runs (report_date DESC);

CREATE INDEX IF NOT EXISTS digest_runs_status_created_idx
  ON public.digest_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pipeline_stage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL CHECK (
    stage_name IN (
      'source_fetch',
      'article_normalization',
      'story_clustering',
      'enrichment',
      'editorial_scoring',
      'reader_publication',
      'finalization'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_run_id, stage_name)
);

CREATE INDEX IF NOT EXISTS pipeline_stage_runs_run_status_idx
  ON public.pipeline_stage_runs (digest_run_id, status);

CREATE TABLE IF NOT EXISTS public.source_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  normalized_url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_items_run_idx
  ON public.source_items (digest_run_id);

CREATE INDEX IF NOT EXISTS source_items_normalized_url_idx
  ON public.source_items (normalized_url);

CREATE TABLE IF NOT EXISTS public.articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  raw_summary TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  enrichment_status TEXT NOT NULL DEFAULT 'not_requested',
  enriched_title TEXT,
  enriched_description TEXT,
  enriched_text TEXT,
  enriched_word_count INTEGER NOT NULL DEFAULT 0 CHECK (enriched_word_count >= 0),
  enriched_fetched_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS articles_last_seen_idx
  ON public.articles (last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS articles_category_idx
  ON public.articles (category);

CREATE TABLE IF NOT EXISTS public.story_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  canonical_title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source TEXT NOT NULL,
  latest_summary TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  latest_published_at TIMESTAMPTZ,
  latest_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  latest_duplicate_count INTEGER NOT NULL DEFAULT 1 CHECK (latest_duplicate_count >= 1),
  confirmation_count INTEGER NOT NULL DEFAULT 1 CHECK (confirmation_count >= 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS story_clusters_last_seen_idx
  ON public.story_clusters (last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS story_clusters_category_idx
  ON public.story_clusters (category);

CREATE TABLE IF NOT EXISTS public.story_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  editorial_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  impact_score INTEGER NOT NULL DEFAULT 0,
  novelty_score INTEGER NOT NULL DEFAULT 0,
  confirmation_score INTEGER NOT NULL DEFAULT 0,
  scope_fit_score INTEGER NOT NULL DEFAULT 0,
  urgency_score INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 1 CHECK (duplicate_count >= 1),
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_run_id, story_cluster_id)
);

CREATE INDEX IF NOT EXISTS story_snapshots_run_selected_idx
  ON public.story_snapshots (digest_run_id, is_selected);

CREATE TABLE IF NOT EXISTS public.enrichment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  fetched_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_run_id, article_id)
);

CREATE INDEX IF NOT EXISTS enrichment_records_run_status_idx
  ON public.enrichment_records (digest_run_id, status);

DROP TRIGGER IF EXISTS set_digest_runs_updated_at ON public.digest_runs;
CREATE TRIGGER set_digest_runs_updated_at
BEFORE UPDATE ON public.digest_runs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_pipeline_stage_runs_updated_at ON public.pipeline_stage_runs;
CREATE TRIGGER set_pipeline_stage_runs_updated_at
BEFORE UPDATE ON public.pipeline_stage_runs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_articles_updated_at ON public.articles;
CREATE TRIGGER set_articles_updated_at
BEFORE UPDATE ON public.articles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_story_clusters_updated_at ON public.story_clusters;
CREATE TRIGGER set_story_clusters_updated_at
BEFORE UPDATE ON public.story_clusters
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_records ENABLE ROW LEVEL SECURITY;
