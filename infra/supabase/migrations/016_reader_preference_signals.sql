ALTER TABLE public.story_clusters
  ADD COLUMN IF NOT EXISTS topic_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.story_clusters
  DROP CONSTRAINT IF EXISTS story_clusters_topic_tags_array,
  DROP CONSTRAINT IF EXISTS story_clusters_entity_tags_array;

ALTER TABLE public.story_clusters
  ADD CONSTRAINT story_clusters_topic_tags_array CHECK (jsonb_typeof(topic_tags) = 'array'),
  ADD CONSTRAINT story_clusters_entity_tags_array CHECK (jsonb_typeof(entity_tags) = 'array');

WITH latest_tags AS (
  SELECT DISTINCT ON (story_cluster_id)
    story_cluster_id,
    topic_tags,
    entity_tags
  FROM public.news_items
  WHERE story_cluster_id IS NOT NULL
  ORDER BY story_cluster_id, last_selected_at DESC NULLS LAST, updated_at DESC
)
UPDATE public.story_clusters AS cluster
SET
  topic_tags = latest_tags.topic_tags,
  entity_tags = latest_tags.entity_tags
FROM latest_tags
WHERE cluster.id = latest_tags.story_cluster_id;

CREATE TABLE IF NOT EXISTS public.reader_preference_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('topic', 'entity', 'source', 'repetition', 'quality')),
  target TEXT NOT NULL CHECK (LENGTH(BTRIM(target)) BETWEEN 1 AND 500),
  reader_source_id UUID REFERENCES public.reader_sources(id) ON DELETE SET NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('more', 'less')),
  origin TEXT NOT NULL CHECK (origin IN ('explicit', 'behavioral')),
  weight DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 10),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  evidence_count INTEGER NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, story_cluster_id, dimension, target, origin),
  CONSTRAINT reader_preference_signals_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS reader_preference_signals_user_dimension_idx
  ON public.reader_preference_signals (user_id, dimension, updated_at DESC);

CREATE INDEX IF NOT EXISTS reader_preference_signals_story_idx
  ON public.reader_preference_signals (story_cluster_id, updated_at DESC);

DROP TRIGGER IF EXISTS set_reader_preference_signals_updated_at ON public.reader_preference_signals;
CREATE TRIGGER set_reader_preference_signals_updated_at
BEFORE UPDATE ON public.reader_preference_signals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.reader_preference_signals (
  user_id,
  story_cluster_id,
  dimension,
  target,
  sentiment,
  origin,
  weight,
  confidence,
  metadata,
  created_at,
  updated_at
)
SELECT
  feedback.user_id,
  feedback.story_cluster_id,
  CASE WHEN feedback.reason = 'repetitive' THEN 'repetition' ELSE feedback.reason END,
  CASE feedback.reason
    WHEN 'topic' THEN COALESCE(NULLIF(cluster.topic_tags ->> 0, ''), cluster.category)
    WHEN 'source' THEN cluster.source
    ELSE feedback.story_cluster_id::TEXT
  END,
  feedback.sentiment,
  'explicit',
  1,
  1,
  jsonb_build_object('migratedFrom', 'reader_story_feedback'),
  feedback.created_at,
  feedback.updated_at
FROM public.reader_story_feedback AS feedback
JOIN public.story_clusters AS cluster ON cluster.id = feedback.story_cluster_id
ON CONFLICT (user_id, story_cluster_id, dimension, target, origin) DO NOTHING;

ALTER TABLE public.reader_preference_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reader_preference_signals FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reader_preference_signals TO authenticated;
GRANT ALL ON public.reader_preference_signals TO service_role;

DROP POLICY IF EXISTS "Readers manage their own preference signals" ON public.reader_preference_signals;
CREATE POLICY "Readers manage their own preference signals"
ON public.reader_preference_signals
FOR ALL
TO authenticated
USING (auth.uid() = user_id AND (SELECT private.is_allowed_reader()))
WITH CHECK (auth.uid() = user_id AND (SELECT private.is_allowed_reader()));

COMMENT ON TABLE public.reader_preference_signals IS
  'Multi-dimensional explicit and behavioral preference evidence. Legacy feedback tables remain during dual-write rollout.';
