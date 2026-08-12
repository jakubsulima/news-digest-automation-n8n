ALTER TABLE public.digest_summaries
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS watchlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_note TEXT NOT NULL DEFAULT 'Brak informacji o pokryciu materiału.',
  ADD COLUMN IF NOT EXISTS reading_time_minutes SMALLINT NOT NULL DEFAULT 5;

ALTER TABLE public.digest_summaries
  DROP CONSTRAINT IF EXISTS digest_summaries_sections_array,
  ADD CONSTRAINT digest_summaries_sections_array CHECK (jsonb_typeof(sections) = 'array'),
  DROP CONSTRAINT IF EXISTS digest_summaries_watchlist_array,
  ADD CONSTRAINT digest_summaries_watchlist_array CHECK (jsonb_typeof(watchlist) = 'array'),
  DROP CONSTRAINT IF EXISTS digest_summaries_coverage_note_nonempty,
  ADD CONSTRAINT digest_summaries_coverage_note_nonempty CHECK (LENGTH(TRIM(coverage_note)) > 0),
  DROP CONSTRAINT IF EXISTS digest_summaries_reading_time_range,
  ADD CONSTRAINT digest_summaries_reading_time_range CHECK (reading_time_minutes BETWEEN 1 AND 5);
