CREATE INDEX IF NOT EXISTS story_cluster_sources_first_seen_run_idx
  ON public.story_cluster_sources (first_seen_digest_run_id)
  WHERE first_seen_digest_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reader_preference_signals_source_idx
  ON public.reader_preference_signals (reader_source_id)
  WHERE reader_source_id IS NOT NULL;

DROP POLICY IF EXISTS "Readers manage their own preference signals"
  ON public.reader_preference_signals;

CREATE POLICY "Readers manage their own preference signals"
ON public.reader_preference_signals
FOR ALL
TO authenticated
USING (
  (SELECT auth.uid()) = user_id
  AND (SELECT private.is_allowed_reader())
)
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND (SELECT private.is_allowed_reader())
);
