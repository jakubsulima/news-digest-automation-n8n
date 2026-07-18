ALTER TABLE public.reader_sources
  ADD COLUMN IF NOT EXISTS selection_mode TEXT;

UPDATE public.reader_sources
SET selection_mode = CASE WHEN enabled THEN 'always_on' ELSE 'blocked' END
WHERE selection_mode IS NULL;

ALTER TABLE public.reader_sources
  ALTER COLUMN selection_mode SET DEFAULT 'auto',
  ALTER COLUMN selection_mode SET NOT NULL,
  DROP CONSTRAINT IF EXISTS reader_sources_selection_mode_check;

ALTER TABLE public.reader_sources
  ADD CONSTRAINT reader_sources_selection_mode_check CHECK (
    selection_mode IN ('auto', 'always_on', 'blocked')
  );

ALTER TABLE public.reader_digest_settings
  ADD COLUMN IF NOT EXISTS source_portfolio_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_budget INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS source_probe_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recommendation_policy_mode TEXT NOT NULL DEFAULT 'shadow',
  ADD COLUMN IF NOT EXISTS source_category_minimums JSONB NOT NULL DEFAULT
    '{"geopolitics":2,"business":2,"ai":2,"software":2,"security":2}'::jsonb;

ALTER TABLE public.reader_digest_settings
  DROP CONSTRAINT IF EXISTS reader_digest_settings_source_portfolio_mode_check,
  DROP CONSTRAINT IF EXISTS reader_digest_settings_source_budget_check,
  DROP CONSTRAINT IF EXISTS reader_digest_settings_source_probe_count_check,
  DROP CONSTRAINT IF EXISTS reader_digest_settings_recommendation_policy_mode_check,
  DROP CONSTRAINT IF EXISTS reader_digest_settings_source_category_minimums_object;

ALTER TABLE public.reader_digest_settings
  ADD CONSTRAINT reader_digest_settings_source_portfolio_mode_check CHECK (
    source_portfolio_mode IN ('manual', 'advisory', 'automatic')
  ),
  ADD CONSTRAINT reader_digest_settings_source_budget_check CHECK (source_budget BETWEEN 5 AND 200),
  ADD CONSTRAINT reader_digest_settings_source_probe_count_check CHECK (source_probe_count BETWEEN 0 AND 10),
  ADD CONSTRAINT reader_digest_settings_recommendation_policy_mode_check CHECK (
    recommendation_policy_mode IN ('shadow', 'v2', 'v1')
  ),
  ADD CONSTRAINT reader_digest_settings_source_category_minimums_object CHECK (
    jsonb_typeof(source_category_minimums) = 'object'
  );

CREATE TABLE IF NOT EXISTS public.digest_run_source_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_run_id UUID NOT NULL REFERENCES public.digest_runs(id) ON DELETE CASCADE,
  reader_source_id UUID NOT NULL REFERENCES public.reader_sources(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL CHECK (LENGTH(policy_version) BETWEEN 1 AND 100),
  portfolio_mode TEXT NOT NULL CHECK (portfolio_mode IN ('manual', 'advisory', 'automatic')),
  legacy_enabled BOOLEAN NOT NULL,
  proposed_selected BOOLEAN NOT NULL,
  actual_selected BOOLEAN NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('selected', 'explore', 'probe', 'skipped')),
  score DOUBLE PRECISION NOT NULL CHECK (
    score NOT IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)
  ),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  score_components JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (digest_run_id, reader_source_id),
  CONSTRAINT digest_run_source_decisions_score_components_object CHECK (
    jsonb_typeof(score_components) = 'object'
  ),
  CONSTRAINT digest_run_source_decisions_reasons_array CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT digest_run_source_decisions_role_selected_check CHECK (
    (actual_selected AND role IN ('selected', 'explore')) OR
    (NOT actual_selected AND role IN ('probe', 'skipped'))
  )
);

CREATE INDEX IF NOT EXISTS digest_run_source_decisions_run_role_idx
  ON public.digest_run_source_decisions (digest_run_id, role, score DESC);

CREATE INDEX IF NOT EXISTS digest_run_source_decisions_source_created_idx
  ON public.digest_run_source_decisions (reader_source_id, created_at DESC);

ALTER TABLE public.digest_run_source_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.digest_run_source_decisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.digest_run_source_decisions TO service_role;

COMMENT ON TABLE public.digest_run_source_decisions IS
  'Frozen, versioned Source Portfolio proposal and actual fetch role for one digest run.';
