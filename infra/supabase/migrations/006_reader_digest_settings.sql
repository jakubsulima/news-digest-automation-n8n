CREATE TABLE IF NOT EXISTS public.reader_digest_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  publish_top_n INTEGER NOT NULL DEFAULT 30 CHECK (publish_top_n BETWEEN 5 AND 100),
  summary_max_chars INTEGER NOT NULL DEFAULT 700 CHECK (summary_max_chars BETWEEN 180 AND 5000),
  minimum_importance_score INTEGER NOT NULL DEFAULT 0 CHECK (minimum_importance_score BETWEEN 0 AND 100),
  feed_targets JSONB NOT NULL DEFAULT '{"geopolitics":14,"business":6,"ai":4,"software":4,"security":2}'::jsonb,
  preferred_keywords JSONB NOT NULL DEFAULT '["ai","nvidia","semiconductor","security","markets"]'::jsonb,
  excluded_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  require_major_security BOOLEAN NOT NULL DEFAULT TRUE,
  use_ai_summaries BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reader_digest_settings_feed_targets_object CHECK (jsonb_typeof(feed_targets) = 'object'),
  CONSTRAINT reader_digest_settings_preferred_keywords_array CHECK (jsonb_typeof(preferred_keywords) = 'array'),
  CONSTRAINT reader_digest_settings_excluded_keywords_array CHECK (jsonb_typeof(excluded_keywords) = 'array')
);

DROP TRIGGER IF EXISTS set_reader_digest_settings_updated_at ON public.reader_digest_settings;
CREATE TRIGGER set_reader_digest_settings_updated_at
BEFORE UPDATE ON public.reader_digest_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reader_digest_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allowed readers can view own digest settings" ON public.reader_digest_settings;
CREATE POLICY "Allowed readers can view own digest settings"
ON public.reader_digest_settings
FOR SELECT
TO authenticated
USING (private.is_allowed_reader() AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can insert own digest settings" ON public.reader_digest_settings;
CREATE POLICY "Allowed readers can insert own digest settings"
ON public.reader_digest_settings
FOR INSERT
TO authenticated
WITH CHECK (private.is_allowed_reader() AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Allowed readers can update own digest settings" ON public.reader_digest_settings;
CREATE POLICY "Allowed readers can update own digest settings"
ON public.reader_digest_settings
FOR UPDATE
TO authenticated
USING (private.is_allowed_reader() AND user_id = (SELECT auth.uid()))
WITH CHECK (private.is_allowed_reader() AND user_id = (SELECT auth.uid()));
