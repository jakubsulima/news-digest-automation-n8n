CREATE TABLE IF NOT EXISTS public.story_cluster_sources (
  story_cluster_id UUID NOT NULL REFERENCES public.story_clusters(id) ON DELETE CASCADE,
  reader_source_id UUID NOT NULL REFERENCES public.reader_sources(id) ON DELETE CASCADE,
  first_seen_digest_run_id UUID REFERENCES public.digest_runs(id) ON DELETE SET NULL,
  last_seen_digest_run_id UUID REFERENCES public.digest_runs(id) ON DELETE SET NULL,
  contribution_type TEXT NOT NULL CHECK (contribution_type IN ('canonical', 'confirmation')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_cluster_id, reader_source_id)
);

CREATE INDEX IF NOT EXISTS story_cluster_sources_source_seen_idx
  ON public.story_cluster_sources (reader_source_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS story_cluster_sources_last_run_idx
  ON public.story_cluster_sources (last_seen_digest_run_id)
  WHERE last_seen_digest_run_id IS NOT NULL;

INSERT INTO public.story_cluster_sources (
  story_cluster_id,
  reader_source_id,
  first_seen_digest_run_id,
  last_seen_digest_run_id,
  contribution_type,
  first_seen_at,
  last_seen_at
)
SELECT
  links.story_cluster_id,
  (articles.metadata ->> 'readerSourceId')::UUID,
  (ARRAY_AGG(links.first_seen_digest_run_id ORDER BY links.first_seen_at ASC)
    FILTER (WHERE links.first_seen_digest_run_id IS NOT NULL))[1],
  (ARRAY_AGG(links.last_seen_digest_run_id ORDER BY links.last_seen_at DESC)
    FILTER (WHERE links.last_seen_digest_run_id IS NOT NULL))[1],
  CASE WHEN BOOL_OR(links.is_canonical) THEN 'canonical' ELSE 'confirmation' END,
  MIN(links.first_seen_at),
  MAX(links.last_seen_at)
FROM public.story_cluster_articles AS links
JOIN public.articles AS articles ON articles.id = links.article_id
WHERE COALESCE(articles.metadata ->> 'readerSourceId', '') ~*
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
GROUP BY links.story_cluster_id, (articles.metadata ->> 'readerSourceId')::UUID
ON CONFLICT (story_cluster_id, reader_source_id) DO UPDATE SET
  last_seen_digest_run_id = EXCLUDED.last_seen_digest_run_id,
  contribution_type = EXCLUDED.contribution_type,
  last_seen_at = EXCLUDED.last_seen_at;

ALTER TABLE public.story_cluster_sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.story_cluster_sources FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.story_cluster_sources TO service_role;

COMMENT ON TABLE public.story_cluster_sources IS
  'Stable source identity and canonical or confirmation contribution for each Story Cluster.';
