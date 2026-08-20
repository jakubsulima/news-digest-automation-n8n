ALTER TABLE public.reader_digest_settings
  ALTER COLUMN use_ai_summaries SET DEFAULT TRUE;

UPDATE public.reader_digest_settings
SET use_ai_summaries = TRUE
WHERE use_ai_summaries = FALSE;
