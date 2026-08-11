-- Preserve historical source attribution while removing low-signal sources
-- from every future portfolio.
UPDATE public.reader_sources
SET
  enabled = FALSE,
  selection_mode = 'blocked'
WHERE feed_url IN (
  'https://spidersweb.pl/feed',
  'https://antyweb.pl/feed',
  'https://www.dobreprogramy.pl/rss/aktualnosci',
  'https://naukawpolsce.pl/rss.xml'
);

UPDATE public.reader_sources
SET
  enabled = FALSE,
  selection_mode = 'blocked'
WHERE name = ANY (ARRAY[
  'POLITICO Europe',
  'ABC News International',
  'CBS News World',
  'SBS News Latest',
  'Hacker News Frontpage',
  'Hacker News Best',
  'Hacker News Newest',
  'Lobsters',
  'Ars Technica',
  'The Register',
  'BBC Technology',
  'GitHub Blog',
  'GitHub Engineering',
  'InfoQ',
  'Martin Fowler',
  'Cloudflare Blog',
  'Kubernetes Blog',
  'AWS News Blog',
  'Microsoft Azure Blog',
  'Rust Blog',
  'Go Blog',
  'Node.js Blog',
  'LWN.net',
  'OpenAI News',
  'Google DeepMind Blog',
  'Google AI Blog',
  'Google Research Blog',
  'Hugging Face Blog',
  'NVIDIA Blog - AI',
  'Import AI',
  'TechCrunch AI',
  'MIT Technology Review AI',
  'VentureBeat AI',
  'The Verge AI',
  'BleepingComputer',
  'The Hacker News',
  'KrebsOnSecurity',
  'CISA Current Activity',
  'Google Online Security Blog',
  'Microsoft Security Blog',
  'Unit 42',
  'Cisco Talos Blog',
  'Google Project Zero',
  'SANS ISC Diary',
  'NCSC UK Guidance',
  'SecurityWeek',
  'Cybersecurity Dive',
  'Dark Reading',
  'Risky Business News',
  'SEC EDGAR Current Filings',
  'SEC EDGAR Recent 10-K',
  'SEC EDGAR Recent 8-K'
]::TEXT[]);

INSERT INTO public.reader_sources (
  name,
  category,
  feed_url,
  priority,
  enabled,
  selection_mode,
  normalized_feed_url,
  canonical_host,
  feed_type,
  language,
  validation_status,
  last_validated_at,
  validation_diagnostics
)
VALUES
  (
    'Le Monde International',
    'Świat / Geopolityka / Europa',
    'https://www.lemonde.fr/en/international/rss_full.xml',
    4,
    TRUE,
    'always_on',
    'https://www.lemonde.fr/en/international/rss_full.xml',
    'www.lemonde.fr',
    'rss',
    'en',
    'valid',
    NOW(),
    '{"verifiedContentType":"application/xml"}'::jsonb
  ),
  (
    'Radio Free Europe / Radio Liberty',
    'Świat / Geopolityka / Europa Wschodnia i Azja Centralna',
    'https://www.rferl.org/api/zbqiml-vomx-tpeqkmy',
    4,
    TRUE,
    'always_on',
    'https://www.rferl.org/api/zbqiml-vomx-tpeqkmy',
    'www.rferl.org',
    'rss',
    'en',
    'valid',
    NOW(),
    '{"verifiedContentType":"text/xml"}'::jsonb
  ),
  (
    'European Council on Foreign Relations',
    'Świat / Geopolityka / Analizy',
    'https://ecfr.eu/feed/',
    4,
    TRUE,
    'always_on',
    'https://ecfr.eu/feed/',
    'ecfr.eu',
    'rss',
    'en',
    'valid',
    NOW(),
    '{"verifiedContentType":"application/rss+xml"}'::jsonb
  ),
  (
    'SIPRI',
    'Świat / Geopolityka / Obronność i konflikty',
    'https://www.sipri.org/rss/combined.xml',
    4,
    TRUE,
    'always_on',
    'https://www.sipri.org/rss/combined.xml',
    'www.sipri.org',
    'rss',
    'en',
    'valid',
    NOW(),
    '{"verifiedContentType":"application/rss+xml"}'::jsonb
  )
ON CONFLICT (feed_url) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  priority = EXCLUDED.priority,
  enabled = EXCLUDED.enabled,
  selection_mode = EXCLUDED.selection_mode,
  normalized_feed_url = EXCLUDED.normalized_feed_url,
  canonical_host = EXCLUDED.canonical_host,
  feed_type = EXCLUDED.feed_type,
  language = EXCLUDED.language,
  validation_status = EXCLUDED.validation_status,
  last_validated_at = EXCLUDED.last_validated_at,
  validation_diagnostics = EXCLUDED.validation_diagnostics;
