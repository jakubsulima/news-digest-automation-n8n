ALTER TABLE public.reader_feed_events
  ADD COLUMN IF NOT EXISTS ranking_context_id UUID,
  ADD COLUMN IF NOT EXISTS policy_version TEXT,
  ADD COLUMN IF NOT EXISTS model_rank INTEGER,
  ADD COLUMN IF NOT EXISTS rank_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS score_components JSONB,
  ADD COLUMN IF NOT EXISTS recommendation_reasons JSONB,
  ADD COLUMN IF NOT EXISTS is_exploration BOOLEAN,
  ADD COLUMN IF NOT EXISTS interaction_origin TEXT,
  ADD COLUMN IF NOT EXISTS impression_key TEXT;

ALTER TABLE public.reader_feed_events
  DROP CONSTRAINT IF EXISTS reader_feed_events_model_rank_nonnegative,
  DROP CONSTRAINT IF EXISTS reader_feed_events_rank_score_finite,
  DROP CONSTRAINT IF EXISTS reader_feed_events_score_components_object,
  DROP CONSTRAINT IF EXISTS reader_feed_events_recommendation_reasons_array,
  DROP CONSTRAINT IF EXISTS reader_feed_events_policy_version_length,
  DROP CONSTRAINT IF EXISTS reader_feed_events_interaction_origin_check,
  DROP CONSTRAINT IF EXISTS reader_feed_events_impression_key_check;

ALTER TABLE public.reader_feed_events
  ADD CONSTRAINT reader_feed_events_model_rank_nonnegative CHECK (model_rank IS NULL OR model_rank >= 0),
  ADD CONSTRAINT reader_feed_events_rank_score_finite CHECK (
    rank_score IS NULL OR rank_score NOT IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)
  ),
  ADD CONSTRAINT reader_feed_events_score_components_object CHECK (
    score_components IS NULL OR jsonb_typeof(score_components) = 'object'
  ),
  ADD CONSTRAINT reader_feed_events_recommendation_reasons_array CHECK (
    recommendation_reasons IS NULL OR jsonb_typeof(recommendation_reasons) = 'array'
  ),
  ADD CONSTRAINT reader_feed_events_policy_version_length CHECK (
    policy_version IS NULL OR LENGTH(policy_version) BETWEEN 1 AND 100
  ),
  ADD CONSTRAINT reader_feed_events_interaction_origin_check CHECK (
    interaction_origin IS NULL OR interaction_origin IN ('direct', 'bulk', 'automatic')
  ),
  ADD CONSTRAINT reader_feed_events_impression_key_check CHECK (
    impression_key IS NULL OR (event_type = 'impression' AND LENGTH(impression_key) <= 200)
  );

CREATE UNIQUE INDEX IF NOT EXISTS reader_feed_events_impression_key_unique_idx
  ON public.reader_feed_events (impression_key);

CREATE INDEX IF NOT EXISTS reader_feed_events_attribution_idx
  ON public.reader_feed_events (user_id, ranking_context_id, story_cluster_id, created_at DESC)
  WHERE ranking_context_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reader_feed_events_policy_created_idx
  ON public.reader_feed_events (policy_version, created_at DESC)
  WHERE policy_version IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.digest_recommendation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL CHECK (LENGTH(policy_version) BETWEEN 1 AND 100),
  eligible BOOLEAN NOT NULL,
  selected BOOLEAN NOT NULL,
  eligibility_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_rank INTEGER NOT NULL CHECK (candidate_rank >= 0),
  selection_rank INTEGER CHECK (selection_rank IS NULL OR selection_rank >= 0),
  score DOUBLE PRECISION NOT NULL CHECK (
    score NOT IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)
  ),
  score_components JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  selection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_run_id, story_cluster_id, policy_version),
  CONSTRAINT digest_recommendation_decisions_eligibility_reasons_array CHECK (
    jsonb_typeof(eligibility_reasons) = 'array'
  ),
  CONSTRAINT digest_recommendation_decisions_score_components_object CHECK (
    jsonb_typeof(score_components) = 'object'
  ),
  CONSTRAINT digest_recommendation_decisions_recommendation_reasons_array CHECK (
    jsonb_typeof(recommendation_reasons) = 'array'
  ),
  CONSTRAINT digest_recommendation_decisions_selection_reasons_array CHECK (
    jsonb_typeof(selection_reasons) = 'array'
  ),
  CONSTRAINT digest_recommendation_decisions_selected_rank_check CHECK (
    (selected AND selection_rank IS NOT NULL) OR (NOT selected AND selection_rank IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS digest_recommendation_decisions_run_selected_idx
  ON public.digest_recommendation_decisions (digest_run_id, selected, selection_rank);

CREATE INDEX IF NOT EXISTS digest_recommendation_decisions_cluster_created_idx
  ON public.digest_recommendation_decisions (story_cluster_id, created_at DESC);

DROP TRIGGER IF EXISTS set_digest_recommendation_decisions_updated_at ON public.digest_recommendation_decisions;
CREATE TRIGGER set_digest_recommendation_decisions_updated_at
BEFORE UPDATE ON public.digest_recommendation_decisions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.digest_recommendation_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.digest_recommendation_decisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.digest_recommendation_decisions TO service_role;

COMMENT ON COLUMN public.reader_feed_events.ranking_context_id IS
  'Identifies one stable Reader ranking context across visible sections and appended pagination.';
COMMENT ON COLUMN public.reader_feed_events.model_rank IS
  'Zero-based rank before Reader grouping; rank stores the zero-based displayed position.';
COMMENT ON COLUMN public.reader_feed_events.impression_key IS
  'Server-derived idempotency key for one visible Story Cluster Exposure in one ranking context.';
COMMENT ON TABLE public.digest_recommendation_decisions IS
  'Versioned Digest Builder eligibility and selection evidence retained with the digest run.';
