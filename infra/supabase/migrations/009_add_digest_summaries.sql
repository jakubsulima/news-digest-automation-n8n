CREATE TABLE IF NOT EXISTS public.digest_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL UNIQUE REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  summary TEXT NOT NULL CHECK (LENGTH(TRIM(summary)) > 0),
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digest_summaries_highlights_array CHECK (jsonb_typeof(highlights) = 'array')
);

CREATE INDEX IF NOT EXISTS digest_summaries_digest_date_idx
  ON public.digest_summaries (digest_date DESC, created_at DESC);

DROP TRIGGER IF EXISTS set_digest_summaries_updated_at ON public.digest_summaries;
CREATE TRIGGER set_digest_summaries_updated_at
BEFORE UPDATE ON public.digest_summaries
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.digest_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allowed readers can view digest summaries" ON public.digest_summaries;
CREATE POLICY "Allowed readers can view digest summaries"
ON public.digest_summaries
FOR SELECT
TO authenticated
USING ((SELECT private.is_allowed_reader()));
