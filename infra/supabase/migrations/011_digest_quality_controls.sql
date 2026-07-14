ALTER TABLE public.reader_digest_settings
  ADD COLUMN IF NOT EXISTS freshness_window_hours INTEGER NOT NULL DEFAULT 72
    CHECK (freshness_window_hours BETWEEN 6 AND 336),
  ADD COLUMN IF NOT EXISTS minimum_source_count INTEGER NOT NULL DEFAULT 1
    CHECK (minimum_source_count BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS max_stories_per_source INTEGER NOT NULL DEFAULT 4
    CHECK (max_stories_per_source BETWEEN 1 AND 20);

COMMENT ON COLUMN public.reader_digest_settings.freshness_window_hours IS
  'Maximum age of a story eligible for a new digest, in hours.';
COMMENT ON COLUMN public.reader_digest_settings.minimum_source_count IS
  'Minimum number of matching source items required for a story.';
COMMENT ON COLUMN public.reader_digest_settings.max_stories_per_source IS
  'Maximum selected stories attributed to one source per digest.';
