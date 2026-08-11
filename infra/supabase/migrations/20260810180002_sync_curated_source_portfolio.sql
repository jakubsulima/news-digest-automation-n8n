CREATE TEMP TABLE desired_reader_sources (
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  priority INTEGER NOT NULL,
  language TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO desired_reader_sources (name, category, feed_url, priority, language)
VALUES
  ('300Gospodarka', 'Polska / Gospodarka / Technologie', 'https://300gospodarka.pl/feed', 4, 'pl'),
  ('Bankier Wiadomości', 'Polska / Gospodarka / Giełda', 'https://www.bankier.pl/rss/wiadomosci.xml', 4, 'pl'),
  ('Bankier Giełda', 'Polska / Giełda', 'https://www.bankier.pl/rss/gielda.xml', 4, 'pl'),
  ('Niebezpiecznik', 'Cyberbezpieczeństwo PL', 'https://feeds.feedburner.com/niebezpiecznik/', 1, 'pl'),
  ('CERT Polska', 'Cyberbezpieczeństwo PL', 'https://cert.pl/feed/', 1, 'pl'),
  ('BBC World', 'Świat / Geopolityka', 'https://feeds.bbci.co.uk/news/world/rss.xml', 5, 'en'),
  ('The Guardian World', 'Świat / Geopolityka', 'https://www.theguardian.com/world/rss', 5, 'en'),
  ('Al Jazeera', 'Świat / Geopolityka', 'https://www.aljazeera.com/xml/rss/all.xml', 4, 'en'),
  ('Deutsche Welle World', 'Świat / Geopolityka / Europa', 'https://rss.dw.com/rdf/rss-en-world', 4, 'en'),
  ('France 24 English', 'Świat / Geopolityka', 'https://www.france24.com/en/rss', 4, 'en'),
  ('NPR World', 'Świat / Geopolityka', 'https://feeds.npr.org/1004/rss.xml', 4, 'en'),
  ('Sky News World', 'Świat / Geopolityka', 'https://feeds.skynews.com/feeds/rss/world.xml', 4, 'en'),
  ('Euronews World', 'Świat / Geopolityka / Europa', 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', 4, 'en'),
  ('UN News', 'Świat / Geopolityka / Organizacje', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', 3, 'en'),
  ('EU Commission Press Corner', 'Świat / Geopolityka / Europa', 'https://ec.europa.eu/commission/presscorner/api/rss?language=en', 3, 'en'),
  ('Le Monde International', 'Świat / Geopolityka / Europa', 'https://www.lemonde.fr/en/international/rss_full.xml', 4, 'en'),
  ('Radio Free Europe / Radio Liberty', 'Świat / Geopolityka / Europa Wschodnia i Azja Centralna', 'https://www.rferl.org/api/zbqiml-vomx-tpeqkmy', 4, 'en'),
  ('European Council on Foreign Relations', 'Świat / Geopolityka / Analizy', 'https://ecfr.eu/feed/', 4, 'en'),
  ('SIPRI', 'Świat / Geopolityka / Obronność i konflikty', 'https://www.sipri.org/rss/combined.xml', 4, 'en'),
  ('Rest of World Global', 'Świat / Technologie / Biznes', 'https://restofworld.org/feed/global/', 4, 'en'),
  ('BBC Business', 'Świat / Biznes / Makro', 'https://feeds.bbci.co.uk/news/business/rss.xml', 4, 'en'),
  ('The Guardian Business', 'Świat / Biznes / Makro', 'https://www.theguardian.com/uk/business/rss', 3, 'en'),
  ('NPR Business', 'Świat / Biznes / Makro', 'https://feeds.npr.org/1006/rss.xml', 3, 'en'),
  ('Deutsche Welle Business', 'Świat / Biznes / Europa', 'https://rss.dw.com/rdf/rss-en-bus', 3, 'en'),
  ('Rest of World Money', 'Świat / Gospodarka cyfrowa', 'https://restofworld.org/feed/money/', 4, 'en'),
  ('SEC Press Releases', 'Świat / Biznes / Regulator', 'https://www.sec.gov/news/pressreleases.rss', 3, 'en'),
  ('Federal Reserve Press Releases', 'Świat / Biznes / Bank centralny', 'https://www.federalreserve.gov/feeds/press_all.xml', 4, 'en'),
  ('ECB Press', 'Świat / Biznes / Bank centralny', 'https://www.ecb.europa.eu/rss/press.html', 4, 'en'),
  ('EIA Today in Energy', 'Świat / Biznes / Energy', 'https://www.eia.gov/rss/todayinenergy.xml', 3, 'en'),
  ('CISA Cybersecurity Advisories', 'Security / Official', 'https://www.cisa.gov/cybersecurity-advisories/all.xml', 1, 'en');

UPDATE public.reader_sources AS source
SET
  enabled = FALSE,
  selection_mode = 'blocked'
WHERE NOT EXISTS (
  SELECT 1
  FROM desired_reader_sources AS desired
  WHERE desired.feed_url = source.feed_url
);

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
SELECT
  desired.name,
  desired.category,
  desired.feed_url,
  desired.priority,
  TRUE,
  'always_on',
  desired.feed_url,
  LOWER(SPLIT_PART(SPLIT_PART(desired.feed_url, '://', 2), '/', 1)),
  'rss',
  desired.language,
  'valid',
  NOW(),
  '{"sourcePortfolio":"curated-geopolitics-business-v1"}'::jsonb
FROM desired_reader_sources AS desired
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
