const POLISH_DIACRITICS = /[ąćęłńóśźż]/g;
const POLISH_DIACRITIC_REPLACEMENTS: Record<string, string> = {
  "ą": "a",
  "ć": "c",
  "ę": "e",
  "ł": "l",
  "ń": "n",
  "ó": "o",
  "ś": "s",
  "ź": "z",
  "ż": "z",
};

// Each group represents one concept, not a list of independent scoring signals.
// This lets an English preference match Polish reporting (and vice versa)
// without awarding several points for the same idea.
const KEYWORD_EQUIVALENT_GROUPS = [
  ["ai", "artificial intelligence", "sztuczna inteligencja"],
  ["agent", "agents", "ai agent", "ai agents", "agent ai", "agenci ai", "agenta ai", "agentow ai"],
  ["security", "cybersecurity", "bezpieczenstwo", "cyberbezpieczenstwo"],
  ["breach", "data breach", "data leak", "naruszenie danych", "wyciek danych"],
  ["vulnerability", "vulnerabilities", "podatnosc", "podatnosci", "luka bezpieczenstwa", "luki bezpieczenstwa"],
  ["attack", "cyberattack", "atak", "cyberatak"],
  ["zero-day", "zero day", "0-day", "0 day", "dzien zerowy", "luka zero day"],
  ["outage", "service disruption", "awaria", "przerwa w dzialaniu", "niedostepnosc"],
  ["incident", "incydent"],
  ["earnings", "financial results", "wyniki finansowe"],
  ["acquisition", "takeover", "przejecie"],
  ["merger", "fuzja"],
  ["sanction", "sanctions", "sankcja", "sankcje"],
  ["inflation", "inflacja"],
  ["gdp", "pkb", "produkt krajowy brutto"],
  ["layoffs", "job cuts", "zwolnienia", "redukcja zatrudnienia"],
  ["funding", "financing", "finansowanie", "runda finansowania"],
  ["tariff", "tariffs", "clo", "cla", "taryfa", "taryfy"],
  ["rate cut", "interest rate cut", "obnizka stop", "ciecie stop"],
  ["rate", "rates", "interest rates", "stopa procentowa", "stopy procentowe"],
  ["antitrust", "antymonopolowy", "antymonopolowa", "ochrona konkurencji"],
  ["chip", "chips", "uklad scalony", "uklady scalone"],
  ["semiconductor", "semiconductors", "polprzewodnik", "polprzewodniki"],
  [
    "cloud",
    "cloud infrastructure",
    "chmura",
    "chmurowy",
    "chmurowa",
    "chmurowe",
    "chmurowej",
    "infrastruktura chmurowa",
  ],
  ["datacenter", "data center", "centrum danych", "centra danych"],
  ["launch", "release", "debut", "premiera", "wydanie", "uruchomienie", "debiut"],
  ["market", "markets", "rynek", "rynki"],
  ["economy", "business", "gospodarka", "biznes"],
  ["developer", "developers", "programista", "programisci", "deweloper", "deweloperzy"],
  ["software", "oprogramowanie"],
  ["open source", "open-source", "otwarte oprogramowanie", "otwarty kod"],
  ["framework", "frameworks", "platforma programistyczna"],
  ["database", "databases", "baza danych", "bazy danych"],
  ["automation", "automatyzacja"],
  ["workflow", "workflows", "przeplyw pracy", "przeplywy pracy"],
  ["energy", "energia", "energetyka"],
  ["oil", "ropa", "ropa naftowa"],
  ["gas", "gaz", "gaz ziemny"],
  ["trade", "handel", "handel miedzynarodowy"],
  ["war", "wojna"],
  ["defense", "defence", "obrona", "obronnosc"],
  ["military", "wojsko", "militarny", "militarna"],
  ["diplomacy", "dyplomacja"],
  ["election", "elections", "wybory"],
  ["middle east", "bliski wschod"],
  ["european union", "eu", "unia europejska"],
  ["central bank", "central banks", "bank centralny", "banki centralne"],
  ["currency", "currencies", "waluta", "waluty"],
  ["debt", "dlug", "zadluzenie"],
  ["export control", "export controls", "kontrola eksportu", "ograniczenia eksportowe"],
  ["supply chain", "supply chains", "lancuch dostaw", "lancuchy dostaw"],
  ["regulation", "regulations", "regulacja", "regulacje"],
  ["compliance", "zgodnosc", "zgodnosc z przepisami"],
  ["startup", "startups", "startupy"],
  ["valuation", "wycena"],
  ["patch", "security patch", "latka", "aktualizacja bezpieczenstwa"],
  ["integration", "integrations", "integracja", "integracje"],
  ["partnership", "partnerships", "partnerstwo", "wspolpraca"],
  ["pricing", "cennik", "wycena uslugi"],
  ["migration", "migracja"],
  ["advisory", "alert", "ostrzezenie", "komunikat bezpieczenstwa"],
  ["china", "chiny"],
  ["sports", "sport"],
  ["football", "soccer", "pilka nozna"],
  ["celebrity", "celebrities", "celebryta", "celebryci"],
  ["entertainment", "rozrywka"],
  ["local crime", "lokalna przestepczosc", "przestepczosc lokalna"],
  ["lifestyle", "styl zycia"],
  ["travel", "podroze"],
  ["royal", "royals", "rodzina krolewska"],
  ["movie", "movies", "film", "filmy"],
  ["music", "muzyka"],
] as const;

function normalizedTokens(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(POLISH_DIACRITICS, (character) => POLISH_DIACRITIC_REPLACEMENTS[character] || character)
    .match(/[\p{Letter}\p{Number}]+/gu) ?? [];
}

const KEYWORD_EQUIVALENTS = new Map<string, readonly string[]>();

for (const group of KEYWORD_EQUIVALENT_GROUPS) {
  const normalizedGroup = [...new Set(group.map((keyword) => normalizedTokens(keyword).join(" ")).filter(Boolean))];
  for (const keyword of normalizedGroup) KEYWORD_EQUIVALENTS.set(keyword, normalizedGroup);
}

function containsTokenSequence(tokens: readonly string[], sequence: readonly string[]) {
  if (!sequence.length || sequence.length > tokens.length) {
    return false;
  }

  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    if (sequence.every((token, offset) => tokens[start + offset] === token)) {
      return true;
    }
  }

  return false;
}

export function matchingKeywords(text: string, keywords: readonly string[]) {
  const tokens = normalizedTokens(text);
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    const normalizedKeyword = normalizedTokens(keyword).join(" ");
    const equivalentKeywords = KEYWORD_EQUIVALENTS.get(normalizedKeyword) || [normalizedKeyword];
    const conceptId = equivalentKeywords[0];

    if (!normalizedKeyword || seen.has(conceptId)) {
      continue;
    }

    seen.add(conceptId);
    if (equivalentKeywords.some((equivalent) => containsTokenSequence(tokens, equivalent.split(" ")))) {
      matches.push(keyword.trim().toLocaleLowerCase("und"));
    }
  }

  return matches;
}

export function textMatchesAnyKeyword(text: string, keywords: readonly string[]) {
  return matchingKeywords(text, keywords).length > 0;
}

export function keywordHitCount(text: string, keywords: readonly string[]) {
  return matchingKeywords(text, keywords).length;
}
