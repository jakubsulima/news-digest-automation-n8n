ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS story_cluster_id UUID REFERENCES public.story_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editorial_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selection_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_material_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 1 CHECK (source_count >= 1),
  ADD COLUMN IF NOT EXISTS source_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS topic_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.news_items
  DROP CONSTRAINT IF EXISTS news_items_changed_fields_array,
  DROP CONSTRAINT IF EXISTS news_items_source_variants_array,
  DROP CONSTRAINT IF EXISTS news_items_topic_tags_array,
  DROP CONSTRAINT IF EXISTS news_items_entity_tags_array;

ALTER TABLE public.news_items
  ADD CONSTRAINT news_items_changed_fields_array CHECK (jsonb_typeof(changed_fields) = 'array'),
  ADD CONSTRAINT news_items_source_variants_array CHECK (jsonb_typeof(source_variants) = 'array'),
  ADD CONSTRAINT news_items_topic_tags_array CHECK (jsonb_typeof(topic_tags) = 'array'),
  ADD CONSTRAINT news_items_entity_tags_array CHECK (jsonb_typeof(entity_tags) = 'array');

UPDATE public.news_items
SET story_cluster_id = (raw_payload ->> 'storyClusterId')::UUID
WHERE story_cluster_id IS NULL
  AND COALESCE(raw_payload ->> 'storyClusterId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE public.news_items
SET
  editorial_score = COALESCE((raw_payload #>> '{score,editorial}')::DOUBLE PRECISION, importance_score, 0),
  selection_score = COALESCE((raw_payload #>> '{score,components,selection}')::DOUBLE PRECISION, importance_score, 0),
  first_selected_at = COALESCE(first_selected_at, created_at),
  last_selected_at = COALESCE(last_selected_at, updated_at),
  source_count = GREATEST(1, source_count)
WHERE first_selected_at IS NULL OR last_selected_at IS NULL;

WITH duplicate_clusters AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY story_cluster_id
      ORDER BY digest_date DESC, updated_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.news_items
  WHERE story_cluster_id IS NOT NULL
)
UPDATE public.news_items AS news
SET story_cluster_id = NULL
FROM duplicate_clusters
WHERE news.id = duplicate_clusters.id
  AND duplicate_clusters.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS news_items_story_cluster_unique_idx
  ON public.news_items (story_cluster_id);

CREATE INDEX IF NOT EXISTS news_items_last_selected_idx
  ON public.news_items (last_selected_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS news_items_selection_score_idx
  ON public.news_items (selection_score DESC);

CREATE TABLE IF NOT EXISTS public.reader_story_feedback (
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('more', 'less')),
  reason TEXT NOT NULL DEFAULT 'topic' CHECK (reason IN ('topic', 'source', 'repetitive', 'quality')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_cluster_id, user_id)
);

INSERT INTO public.reader_story_feedback (
  story_cluster_id,
  user_id,
  sentiment,
  reason,
  created_at,
  updated_at
)
SELECT
  news.story_cluster_id,
  feedback.user_id,
  feedback.sentiment,
  'topic',
  feedback.created_at,
  feedback.updated_at
FROM public.reader_item_feedback AS feedback
JOIN public.news_items AS news ON news.id = feedback.news_item_id
WHERE news.story_cluster_id IS NOT NULL
ON CONFLICT (story_cluster_id, user_id) DO UPDATE SET
  sentiment = EXCLUDED.sentiment,
  reason = EXCLUDED.reason,
  updated_at = EXCLUDED.updated_at;

CREATE INDEX IF NOT EXISTS reader_story_feedback_user_idx
  ON public.reader_story_feedback (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.reader_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_feed_visited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.story_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (story_cluster_id, digest_run_id),
  CONSTRAINT story_updates_changed_fields_array CHECK (jsonb_typeof(changed_fields) = 'array')
);

CREATE INDEX IF NOT EXISTS story_updates_cluster_created_idx
  ON public.story_updates (story_cluster_id, created_at DESC);

CREATE INDEX IF NOT EXISTS story_updates_digest_run_idx
  ON public.story_updates (digest_run_id);

CREATE TABLE IF NOT EXISTS public.reader_feed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  news_item_id UUID REFERENCES public.news_items(id) ON DELETE SET NULL,
  story_cluster_id UUID REFERENCES public.story_clusters(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('impression', 'fast_read', 'source_open', 'read', 'save', 'archive', 'feedback')
  ),
  rank INTEGER CHECK (rank IS NULL OR rank >= 0),
  sort_mode TEXT CHECK (sort_mode IS NULL OR sort_mode IN ('for-you', 'top', 'latest')),
  feed TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reader_feed_events_user_created_idx
  ON public.reader_feed_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reader_feed_events_story_idx
  ON public.reader_feed_events (story_cluster_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reader_feed_events_news_item_idx
  ON public.reader_feed_events (news_item_id)
  WHERE news_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_reader_story_feedback_updated_at ON public.reader_story_feedback;
CREATE TRIGGER set_reader_story_feedback_updated_at
BEFORE UPDATE ON public.reader_story_feedback
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_reader_profiles_updated_at ON public.reader_profiles;
CREATE TRIGGER set_reader_profiles_updated_at
BEFORE UPDATE ON public.reader_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reader_story_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_feed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allowed readers can manage own story feedback" ON public.reader_story_feedback;
CREATE POLICY "Allowed readers can manage own story feedback"
ON public.reader_story_feedback
FOR ALL
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()))
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can manage own profile" ON public.reader_profiles;
CREATE POLICY "Allowed readers can manage own profile"
ON public.reader_profiles
FOR ALL
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()))
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can view story updates" ON public.story_updates;
CREATE POLICY "Allowed readers can view story updates"
ON public.story_updates
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()));

DROP POLICY IF EXISTS "Allowed readers can view own feed events" ON public.reader_feed_events;
CREATE POLICY "Allowed readers can view own feed events"
ON public.reader_feed_events
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can insert own feed events" ON public.reader_feed_events;
CREATE POLICY "Allowed readers can insert own feed events"
ON public.reader_feed_events
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.is_allowed_reader()) AND user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reader_story_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reader_profiles TO authenticated;
GRANT SELECT ON public.story_updates TO authenticated;
GRANT SELECT, INSERT ON public.reader_feed_events TO authenticated;

GRANT ALL ON public.reader_story_feedback TO service_role;
GRANT ALL ON public.reader_profiles TO service_role;
GRANT ALL ON public.story_updates TO service_role;
GRANT ALL ON public.reader_feed_events TO service_role;
