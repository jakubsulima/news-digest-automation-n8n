ALTER TABLE public.reader_sources
  ADD COLUMN IF NOT EXISTS normalized_feed_url TEXT,
  ADD COLUMN IF NOT EXISTS canonical_host TEXT,
  ADD COLUMN IF NOT EXISTS feed_type TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.reader_sources
SET
  normalized_feed_url = COALESCE(normalized_feed_url, feed_url),
  canonical_host = COALESCE(
    canonical_host,
    LOWER(SPLIT_PART(SPLIT_PART(feed_url, '://', 2), '/', 1))
  ),
  feed_type = COALESCE(feed_type, 'unknown'),
  language = COALESCE(language, 'unknown')
WHERE normalized_feed_url IS NULL OR canonical_host IS NULL OR feed_type IS NULL OR language IS NULL;

ALTER TABLE public.reader_sources
  ALTER COLUMN normalized_feed_url SET NOT NULL,
  ALTER COLUMN canonical_host SET NOT NULL,
  ALTER COLUMN feed_type SET NOT NULL,
  ALTER COLUMN language SET NOT NULL,
  DROP CONSTRAINT IF EXISTS reader_sources_normalized_feed_url_http,
  DROP CONSTRAINT IF EXISTS reader_sources_canonical_host_length,
  DROP CONSTRAINT IF EXISTS reader_sources_feed_type_check,
  DROP CONSTRAINT IF EXISTS reader_sources_language_length,
  DROP CONSTRAINT IF EXISTS reader_sources_validation_status_check,
  DROP CONSTRAINT IF EXISTS reader_sources_validation_diagnostics_object;

ALTER TABLE public.reader_sources
  ADD CONSTRAINT reader_sources_normalized_feed_url_http CHECK (normalized_feed_url ~* '^https?://'),
  ADD CONSTRAINT reader_sources_canonical_host_length CHECK (LENGTH(canonical_host) BETWEEN 1 AND 253),
  ADD CONSTRAINT reader_sources_feed_type_check CHECK (feed_type IN ('rss', 'atom', 'unknown')),
  ADD CONSTRAINT reader_sources_language_length CHECK (LENGTH(language) BETWEEN 2 AND 35),
  ADD CONSTRAINT reader_sources_validation_status_check CHECK (
    validation_status IN ('unverified', 'valid', 'invalid', 'blocked')
  ),
  ADD CONSTRAINT reader_sources_validation_diagnostics_object CHECK (
    jsonb_typeof(validation_diagnostics) = 'object'
  );

CREATE UNIQUE INDEX IF NOT EXISTS reader_sources_normalized_feed_url_unique_idx
  ON public.reader_sources (normalized_feed_url);

CREATE INDEX IF NOT EXISTS reader_sources_validation_status_idx
  ON public.reader_sources (validation_status, last_validated_at DESC NULLS LAST);

COMMENT ON COLUMN public.reader_sources.validation_diagnostics IS
  'Bounded feed discovery evidence such as redirect count, sample size, duplicate ratio, and detected feed metadata.';
