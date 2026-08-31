import "server-only";

import { readingTimeMinutesForDigestBrief, wordCount } from "./digest-brief-text";
import { plainTextFromHtml } from "./text";

type NvidiaChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type NvidiaChatPurpose = "article-preview" | "summary-shortening" | "daily-brief";

const NVIDIA_LOG_PREFIX = "[nvidia-ai]";
const NVIDIA_REQUEST_TIMEOUT_MS = 20_000;
const DAILY_BRIEF_INITIAL_TIMEOUT_MS = 18_000;
const DAILY_BRIEF_TOTAL_TIMEOUT_MS = 28_000;
const DAILY_BRIEF_MIN_CORRECTION_TIMEOUT_MS = 1_000;
const FULL_BRIEF_MIN_WORDS = 450;
const FULL_BRIEF_MAX_WORDS = 650;
const LEAD_MIN_WORDS = 60;
const LEAD_MAX_WORDS = 90;
const SECTION_MIN_WORDS = 90;
const SECTION_MAX_WORDS = 140;

export type NvidiaArticlePreview = {
  clickIf: string;
  entities: string[];
  practicalBucket: string;
  topics: string[];
  whatHappened: string;
  whyItMatters: string;
};

export type DigestBriefArticle = {
  category: string;
  importanceScore: number;
  publishedAt: string | null;
  source: string;
  sourceCount: number;
  summary: string;
  title: string;
  whyInteresting: string | null;
};

export type NvidiaDigestBriefHighlight = {
  articleIndex: number;
  whatHappened: string;
  whyItMatters: string;
};

export type NvidiaDigestBriefSection = {
  category: string;
  paragraphs: Array<{
    articleIndexes: number[];
    text: string;
  }>;
  title: string;
};

export type NvidiaDigestBriefWatchItem = {
  articleIndexes: number[];
  signal: string;
  why: string;
};

export type NvidiaDigestBrief = {
  coverageNote: string;
  highlights: Array<{
    articleIndex: number;
    whatHappened: string;
    whyItMatters: string;
  }>;
  readingTimeMinutes: number;
  sections: NvidiaDigestBriefSection[];
  summary: string;
  summaryArticleIndexes: number[];
  watchlist: NvidiaDigestBriefWatchItem[];
};

export type DigestBriefInterestProfile = {
  feedTargets: Record<string, number>;
  preferredKeywords: string[];
};

const DEFAULT_NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-nano-30b-a3b";

const missingApiKeyWarnings = new Set<NvidiaChatPurpose>();

function nvidiaApiUrl() {
  return process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL;
}

function nvidiaModel() {
  return process.env.NVIDIA_MODEL || process.env.NVIDIA_NIM_MODEL || DEFAULT_NVIDIA_MODEL;
}

function logMissingApiKey(purpose: NvidiaChatPurpose) {
  if (missingApiKeyWarnings.has(purpose)) {
    return;
  }

  missingApiKeyWarnings.add(purpose);
  console.warn(NVIDIA_LOG_PREFIX, "request_skipped", { purpose, reason: "missing_api_key" });
}

async function requestNvidiaChat({
  body,
  purpose,
  timeoutMs = NVIDIA_REQUEST_TIMEOUT_MS,
}: {
  body: Record<string, unknown>;
  purpose: NvidiaChatPurpose;
  timeoutMs?: number;
}) {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    logMissingApiKey(purpose);
    return null;
  }

  const model = nvidiaModel();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(nvidiaApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        chat_template_kwargs: {
          ...(typeof body.chat_template_kwargs === "object" && body.chat_template_kwargs
            ? body.chat_template_kwargs
            : {}),
          enable_thinking: false,
        },
        model,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(NVIDIA_LOG_PREFIX, "request_failed", {
        elapsedMs: Date.now() - startedAt,
        model,
        purpose,
        status: response.status,
      });
      return null;
    }

    const payload = (await response.json().catch(() => null)) as NvidiaChatResponse | null;
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      console.warn(NVIDIA_LOG_PREFIX, "response_missing_content", {
        elapsedMs: Date.now() - startedAt,
        model,
        purpose,
        status: response.status,
      });
      return null;
    }

    console.info(NVIDIA_LOG_PREFIX, "request_succeeded", {
      elapsedMs: Date.now() - startedAt,
      model,
      purpose,
      status: response.status,
    });

    return content;
  } catch (error) {
    console.warn(NVIDIA_LOG_PREFIX, "request_error", {
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "unknown_error",
      model,
      purpose,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function hasNvidiaSummaryConfig() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

export async function shortenSummaryWithNvidia({
  maxChars,
  summary,
  title,
}: {
  maxChars: number;
  summary: string;
  title: string;
}) {
  const content = await requestNvidiaChat({
    body: {
      max_tokens: Math.max(80, Math.min(300, Math.ceil(maxChars / 3))),
      messages: [
        {
          role: "system",
          content:
            "Skracaj newsy dla prywatnego dziennego digestu. Pisz naturalną, prostą polszczyzną i zaczynaj od najważniejszego faktu. Zachowuj nazwy, daty, liczby oraz istotny kontekst. Nie opisuj tekstu ani źródła słowami typu „artykuł”, „materiał” lub „podsumowanie” — od razu przedstaw informację. Nie dodawaj opinii, przewidywań ani faktów spoza wejścia.",
        },
        {
          role: "user",
          content: `Tytuł: ${title}\n\nPodsumowanie: ${summary}\n\nZwróć jeden zwięzły akapit po polsku, krótszy niż ${maxChars} znaków.`,
        },
      ],
      temperature: 0.2,
      top_p: 0.7,
    },
    purpose: "summary-shortening",
  });

  return content ? plainTextFromHtml(content).trim() : null;
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? plainTextFromHtml(value).trim() : null;
}

function requiredArticleIndex(value: unknown, articleCount: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < articleCount ? value : null;
}

function boundedStringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.flatMap((entry) => {
            const normalized = requiredString(entry);
            return normalized ? [normalized] : [];
          }),
        ),
      ).slice(0, 8)
    : [];
}

function compactToWordLimit(value: string, maxWords: number) {
  const words = value.split(/\s+/).filter(Boolean);

  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?-]+$/, "")}…` : value;
}

function boundedString(value: unknown, maxChars: number, maxWords: number) {
  const normalized = requiredString(value);
  return normalized ? compactToWordLimit(normalized.slice(0, maxChars).trim(), maxWords) : null;
}

function boundedArticleIndexes(value: unknown, articleCount: number, maxItems = 6) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.flatMap((entry) => {
        const index = requiredArticleIndex(entry, articleCount);
        return index === null ? [] : [index];
      }),
    ),
  ).slice(0, maxItems);
}

function parseSectionParagraphs(
  section: Record<string, unknown>,
  articleCount: number,
): NvidiaDigestBriefSection["paragraphs"] {
  const rawParagraphs = Array.isArray(section.paragraphs)
    ? section.paragraphs
    : typeof section.situation === "string"
      ? [{ text: section.situation, articleIndexes: section.articleIndexes }]
      : [];

  return rawParagraphs.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const paragraph = value as Record<string, unknown>;
    const text = boundedString(paragraph.text, 2_000, SECTION_MAX_WORDS);
    const articleIndexes = boundedArticleIndexes(paragraph.articleIndexes, articleCount);

    return text && articleIndexes.length ? [{ articleIndexes, text }] : [];
  });
}

function fallbackSectionTitle(category: string) {
  const labels: Record<string, string> = {
    ai: "AI",
    business: "Biznes i gospodarka",
    geopolitics: "Geopolityka",
    security: "Cyberbezpieczeństwo",
    software: "Technologia i software",
  };

  return labels[category.toLowerCase()] || category;
}

export function fallbackDigestBrief(articles: DigestBriefArticle[]): NvidiaDigestBrief {
  const highlights = articles.slice(0, 5).map((article, articleIndex) => ({
    articleIndex,
    whatHappened: compactToWordLimit(article.summary, 25),
    whyItMatters: compactToWordLimit(
      article.whyInteresting || `Ważny sygnał ze źródła ${article.source}.`,
      30,
    ),
  }));
  const sections = Array.from(new Set(articles.map((article) => article.category))).slice(0, 5).map((category) => {
    const articleIndexes = articles.flatMap((article, articleIndex) =>
      article.category === category ? [articleIndex] : [],
    ).slice(0, 6);
    const categoryArticles = articleIndexes.map((articleIndex) => articles[articleIndex]);

    return {
      category,
      paragraphs: [
        {
          articleIndexes,
          text: compactToWordLimit(categoryArticles.map((article) => article.summary).join(" "), 65),
        },
      ],
      title: fallbackSectionTitle(category),
    };
  });
  const subject = articles.length === 1 ? "jedną wybraną wiadomość" : "wybrane wiadomości";

  return {
    coverageNote: "Briefing awaryjny utworzony bez syntezy AI; sprawdź połączone materiały źródłowe.",
    highlights,
    readingTimeMinutes: readingTimeMinutesForDigestBrief({
      coverageNote: "Briefing awaryjny utworzony bez syntezy AI; sprawdź połączone materiały źródłowe.",
      sections,
      summary: `Dzisiejszy digest obejmuje ${subject}. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.`,
      watchlist: [],
    }),
    sections,
    summary: `Dzisiejszy digest obejmuje ${subject}. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.`,
    summaryArticleIndexes: highlights.map((highlight) => highlight.articleIndex),
    watchlist: [],
  };
}

function jsonObjectFromModelOutput(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");

    return start >= 0 && end > start ? (JSON.parse(withoutFence.slice(start, end + 1)) as unknown) : null;
  }
}

export function parseDigestBriefJson(content: string, articleCount: number): NvidiaDigestBrief | null {
  try {
    const parsed = jsonObjectFromModelOutput(content);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const brief = parsed as Record<string, unknown>;
    const summary = boundedString(brief.summary, 1_000, LEAD_MAX_WORDS);
    const coverageNote = boundedString(brief.coverageNote, 420, 25);

    if (!summary || !coverageNote || !Array.isArray(brief.highlights) || !Array.isArray(brief.sections)) {
      return null;
    }

    const seen = new Set<number>();
    const highlights = brief.highlights
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }

        const highlight = value as Record<string, unknown>;
        const articleIndex = requiredArticleIndex(highlight.articleIndex, articleCount);
        const whatHappened = boundedString(highlight.whatHappened, 420, 25);
        const whyItMatters = boundedString(highlight.whyItMatters, 420, 30);

        if (articleIndex === null || !whatHappened || !whyItMatters || seen.has(articleIndex)) {
          return null;
        }

        seen.add(articleIndex);
        return { articleIndex, whatHappened, whyItMatters };
      })
      .filter((highlight): highlight is NvidiaDigestBriefHighlight => Boolean(highlight))
      .slice(0, 4);
    // Older model responses predate explicit lead attribution. Treat their
    // highlights as the lead's sources so a parseable legacy brief remains
    // usable and never renders an unsourced lead.
    const requestedSummaryArticleIndexes = Array.isArray(brief.summaryArticleIndexes)
      ? boundedArticleIndexes(brief.summaryArticleIndexes, articleCount, 4)
      : highlights.map((highlight) => highlight.articleIndex);
    const highlightArticleIndexes = new Set(highlights.map((highlight) => highlight.articleIndex));
    const summaryArticleIndexes = requestedSummaryArticleIndexes.filter((articleIndex) =>
      highlightArticleIndexes.has(articleIndex),
    );

    const sections = brief.sections
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }

        const section = value as Record<string, unknown>;
        const category = boundedString(section.category, 80, 8);
        const title = boundedString(section.title, 120, 12);
        const paragraphs = parseSectionParagraphs(section, articleCount);

        return category && title && paragraphs.length
          ? { category, paragraphs, title }
          : null;
      })
      .filter((section): section is NvidiaDigestBriefSection => Boolean(section))
      .slice(0, 4);
    const watchlist = Array.isArray(brief.watchlist)
      ? brief.watchlist
          .map((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              return null;
            }

            const item = value as Record<string, unknown>;
            const signal = boundedString(item.signal, 240, 12);
            const why = boundedString(item.why, 320, 18);
            const articleIndexes = boundedArticleIndexes(item.articleIndexes, articleCount, 4);

            return signal && why ? { articleIndexes, signal, why } : null;
          })
          .filter((item): item is NvidiaDigestBriefWatchItem => Boolean(item))
          .slice(0, 4)
      : [];
    const readingTimeMinutes = readingTimeMinutesForDigestBrief({
      coverageNote,
      sections,
      summary,
      watchlist,
    });

    return highlights.length && summaryArticleIndexes.length && sections.length
      ? { coverageNote, highlights, readingTimeMinutes, sections, summary, summaryArticleIndexes, watchlist }
      : null;
  } catch {
    return null;
  }
}

export function validateDigestBriefQuality(brief: NvidiaDigestBrief) {
  const reasons: string[] = [];
  const leadWords = wordCount(brief.summary);
  const sectionWordCounts = brief.sections.map((section) =>
    wordCount(section.paragraphs.map((paragraph) => paragraph.text).join(" ")),
  );
  const totalWords = readingTimeMinutesForDigestBrief({
    coverageNote: brief.coverageNote,
    sections: brief.sections,
    summary: brief.summary,
    watchlist: brief.watchlist,
  });
  const actualTotalWords = [
    brief.summary,
    ...brief.sections.flatMap((section) => section.paragraphs.map((paragraph) => paragraph.text)),
    ...brief.watchlist.flatMap((item) => [item.signal, item.why]),
    brief.coverageNote,
  ].join(" ").split(/\s+/).filter(Boolean).length;
  const readerFacingText = [
    brief.summary,
    ...brief.highlights.flatMap((highlight) => [highlight.whatHappened, highlight.whyItMatters]),
    ...brief.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs.map((paragraph) => paragraph.text),
    ]),
    ...brief.watchlist.flatMap((item) => [item.signal, item.why]),
    brief.coverageNote,
  ].join(" ").toLowerCase();
  const polishMarkerCount = readerFacingText.match(/\b(?:ale|bez|dla|jest|który|która|może|oraz|przez|się|są|to|wraz|wpływ|został|została)\b/giu)?.length || 0;
  const englishMarkerCount = readerFacingText.match(/\b(?:and|are|could|for|from|has|have|into|may|the|this|that|was|were|while|with|would)\b/giu)?.length || 0;

  if (leadWords < LEAD_MIN_WORDS || leadWords > LEAD_MAX_WORDS) {
    reasons.push(`lead must contain ${LEAD_MIN_WORDS}-${LEAD_MAX_WORDS} words`);
  }
  if (brief.sections.length < 3 || brief.sections.length > 4) {
    reasons.push("briefing must contain 3-4 thematic sections");
  }
  if (sectionWordCounts.some((count) => count < SECTION_MIN_WORDS || count > SECTION_MAX_WORDS)) {
    reasons.push(`each section must contain ${SECTION_MIN_WORDS}-${SECTION_MAX_WORDS} words`);
  }
  if (!brief.watchlist.length) {
    reasons.push("briefing must contain at least one concrete watchlist signal");
  }
  if (!brief.summaryArticleIndexes.length) {
    reasons.push("lead must reference at least one highlighted source");
  }
  if (actualTotalWords < FULL_BRIEF_MIN_WORDS || actualTotalWords > FULL_BRIEF_MAX_WORDS) {
    reasons.push(`briefing must contain ${FULL_BRIEF_MIN_WORDS}-${FULL_BRIEF_MAX_WORDS} displayed words`);
  }
  if (englishMarkerCount >= 6 && englishMarkerCount > polishMarkerCount * 2) {
    reasons.push("all reader-facing text must be written in Polish");
  }

  return {
    actualTotalWords,
    readingTimeMinutes: totalWords,
    valid: reasons.length === 0,
    reasons,
  };
}

export async function digestBriefWithNvidia({
  articles,
  interestProfile,
}: {
  articles: DigestBriefArticle[];
  interestProfile: DigestBriefInterestProfile;
}): Promise<NvidiaDigestBrief> {
  const fallback = fallbackDigestBrief(articles);

  if (!articles.length) {
    return fallback;
  }

  const aiStartedAt = Date.now();

  const sourceMaterial = articles
    .map(
      (article, index) =>
        `Techniczny ID źródła (tylko do pól articleIndex/articleIndexes): ${index}\nKategoria: ${article.category}\nWażność: ${article.importanceScore}/100\nTytuł: ${article.title}\nŹródło: ${article.source} (${article.sourceCount} ${article.sourceCount === 1 ? "źródło" : "źródła"})\nPublikacja: ${article.publishedAt || "brak daty"}\nDlaczego wybrane: ${article.whyInteresting || "brak osobnej adnotacji"}\nTreść: ${article.summary.slice(0, 900)}`,
    )
    .join("\n\n");
  const interests = Object.entries(interestProfile.feedTargets)
    .filter(([, target]) => target > 0)
    .sort(([, left], [, right]) => right - left)
    .map(([category, target]) => `${category}: ${target}`)
    .join(", ");

  const systemPrompt = `Jesteś redaktorem prywatnego briefingu newsowego. Twoim celem jest wyjaśnić wydarzenia tak, aby czytelnik zrozumiał je bez otwierania artykułów źródłowych.

Wszystkie pola widoczne dla czytelnika pisz po polsku, nawet gdy materiały wejściowe są po angielsku. Pozostawiaj w oryginale wyłącznie nazwy własne, nazwy produktów i powszechnie używane skróty. Pisz prostymi, pełnymi zdaniami. Jedno zdanie powinno przekazywać jedną główną myśl.

Każdy akapit musi być samodzielnie zrozumiały. W pierwszym zdaniu nazwij osobę, firmę, instytucję lub państwo i napisz wprost, co się wydarzyło. Następnie dodaj tylko kontekst potrzebny do zrozumienia skali, przyczyny albo następnego kroku. Rozwiń nieoczywisty skrót lub termin przy pierwszym użyciu. Nie zaczynaj od „to”, „ten ruch”, „ta sytuacja” ani podobnego odwołania bez jasno nazwanego poprzednika.

Najpierw podawaj obiektywne fakty. Krótką interpretację dodawaj tylko wtedy, gdy z materiałów wynika konkretny mechanizm wpływu. Nazwij wtedy, kogo wpływ dotyczy i przez co może nastąpić. Używaj ostrożnych słów: „może”, „prawdopodobnie”, „sugeruje” lub „jeśli ten kierunek się utrzyma”. Nie zastępuj wyjaśnienia pustymi zwrotami typu „ma szersze znaczenie”, „podkreśla rosnące ryzyko” albo „może wpłynąć na rynek”.

Łącz doniesienia wyłącznie wtedy, gdy mają bezpośredni, dający się nazwać związek: dotyczą tej samej decyzji, organizacji, zdarzenia, łańcucha przyczynowego lub mierzalnego trendu. Wspólna kategoria, taka jak „biznes”, „AI” czy „geopolityka”, nie jest związkiem. Niezależne newsy opisz w osobnych akapitach. Nie twórz zależności tylko po to, aby tekst brzmiał jak synteza.

Nie dodawaj wiedzy spoza materiałów, nie zgaduj motywacji i nie dopisuj skutków bez wskazanego mechanizmu. Unikaj urzędowego tonu, sloganów, streszczania źródeł po kolei oraz zdań typu „artykuł 0 mówi”, „materiał 1 opisuje” lub „w dostarczonych materiałach”. Techniczne ID źródeł i nazwy pól JSON mogą wystąpić wyłącznie jako metadane w articleIndex i articleIndexes.

Nie podawaj w tekście łącznej liczby newsów ani nie opisuj rozmiaru digestu. Liczba wybieranych wiadomości jest ustawieniem użytkownika i może się zmieniać.

Zwróć wyłącznie poprawny JSON, bez markdownu.`;
  const briefShape =
    '{"summary":"lead 60-90 słów","summaryArticleIndexes":[0],"highlights":[{"articleIndex":0,"whatHappened":"","whyItMatters":""}],"sections":[{"category":"","title":"","paragraphs":[{"text":"","articleIndexes":[0]}]}],"watchlist":[{"signal":"","why":"","articleIndexes":[0]}],"coverageNote":""}';
  const requirements = `
Wymagania redakcyjne:
- wszystkie wartości tekstowe w JSON-ie, poza nazwami własnymi, zapisz po polsku;
- summary to lead o długości 60–90 słów: podaj 2–4 najważniejsze fakty dnia i tylko jedną rzeczywiście udokumentowaną zależność; czytelnik ma od razu wiedzieć, kto zrobił co; każdy fakt lub zależność w summary musi wynikać z materiałów wskazanych w summaryArticleIndexes;
- summaryArticleIndexes zawiera wszystkie i tylko te techniczne ID materiałów, które potwierdzają informacje w summary; każde z tych ID musi też wystąpić jako articleIndex w highlights, aby źródło było widoczne na głównej stronie;
- highlights to 3–4 najważniejsze fakty; whatHappened odpowiada konkretnie „kto zrobił co”, a whyItMatters nazywa podmiot dotknięty zmianą i mechanizm wpływu; jeśli nie da się tego wyjaśnić konkretnie, opisz tylko bezpośrednie znaczenie faktu;
- sections to 3–4 tematyczne sekcje po 90–140 słów; każda sekcja ma 1–3 samodzielne akapity, a każdy akapit ma własne articleIndexes wskazujące dokładnie wykorzystane materiały;
- każdy akapit buduj w kolejności: jedno zdanie z głównym faktem, 1–3 zdania niezbędnego kontekstu, opcjonalnie jedno zdanie o możliwym wpływie lub niewiadomej;
- używaj krótkich tytułów mówiących wprost, czego dotyczy sekcja; unikaj abstrakcyjnych tytułów typu „Zmieniający się krajobraz”, „Nowa dynamika” lub „Rosnące wyzwania”;
- większość tekstu mają stanowić sprawdzalne fakty; pomijaj opinię, jeśli materiały nie dają podstaw do opisania konkretnego wpływu;
- używaj nazw osób, firm, instytucji i zdarzeń zamiast odwołań typu „pierwszy artykuł”, „artykuł 0”, „materiał nr 2”, „powyższe źródło” czy „articleIndex”; żaden techniczny indeks nie może trafić do summary, whatHappened, whyItMatters, title, text, signal, why ani coverageNote;
- nie powtarzaj tej samej informacji w leadzie, highlights i sekcjach, chyba że krótka wzmianka jest konieczna do zrozumienia szerszego związku;
- łączna długość tekstu faktycznie wyświetlanego (summary, akapity sekcji, watchlist i coverageNote) ma wynosić 450–650 słów; nie wydłużaj tekstu przez powtórzenia lub ogólniki;
- watchlist to 1–4 konkretne, wynikające z materiałów sygnały, decyzje lub terminy do obserwowania wraz z rzeczowym powodem; nie wymyślaj dat ani scenariuszy;
- coverageNote to uczciwe zdanie o ograniczeniu materiału;
- articleIndex i articleIndexes są niewidocznymi metadanymi źródeł: wpisuj w nich wyłącznie techniczne ID od 0 do ${articles.length - 1} i nigdy nie przywołuj ich w tekście;
- readingTimeMinutes pomiń — czas zostanie obliczony z faktycznie wyświetlanego tekstu.

Zwróć dokładnie ten kształt JSON:
${briefShape}`;
  const correctionPrompt = (initialOutput: string | null, reasons: string[]) => `Przepisz poniższy briefing tak, aby każdy akapit był zrozumiały bez znajomości artykułów źródłowych. Wszystkie pola tekstowe napisz po polsku. Nazwij wprost podmioty i działania, wyjaśnij nieoczywiste terminy, rozdziel niepowiązane newsy oraz usuń ogólniki, niejasne zaimki i sztuczne zależności. Zachowaj obiektywne fakty, a interpretację ogranicz do krótkich, warunkowych wniosków z konkretnym mechanizmem wpływu. Usuń techniczne indeksy z treści; pozostaw je tylko w articleIndex i articleIndexes. Nie dodawaj nowych faktów tylko po to, by tekst był dłuższy. Zwróć wyłącznie cały poprawny JSON, bez komentarza.

Problemy do naprawy: ${reasons.join("; ") || "odpowiedź nie była poprawnym JSON-em"}.

${requirements}

Pierwsza odpowiedź:
${initialOutput || "brak poprawnej odpowiedzi"}

Materiały:
${sourceMaterial}`;

  try {
    const content = await requestNvidiaChat({
      body: {
        max_tokens: 2_400,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Przygotuj pełny briefing dnia na podstawie materiałów. Priorytety czytelnika: ${interests || "brak wag kategorii"}. Preferowane tematy: ${interestProfile.preferredKeywords.slice(0, 30).join(", ") || "brak"}.${requirements}

Materiały:
${sourceMaterial}`,
          },
        ],
        temperature: 0.1,
        top_p: 0.7,
      },
      purpose: "daily-brief",
      timeoutMs: DAILY_BRIEF_INITIAL_TIMEOUT_MS,
    });

    const articleCount = articles.length;
    const firstBrief = content ? parseDigestBriefJson(content, articleCount) : null;
    const firstQuality = firstBrief ? validateDigestBriefQuality(firstBrief) : null;

    if (!content && !hasNvidiaSummaryConfig()) {
      return fallback;
    }

    if (firstBrief && firstQuality?.valid) {
      return firstBrief;
    }

    const correctionTimeoutMs = Math.min(
      NVIDIA_REQUEST_TIMEOUT_MS,
      DAILY_BRIEF_TOTAL_TIMEOUT_MS - (Date.now() - aiStartedAt),
    );

    if (correctionTimeoutMs < DAILY_BRIEF_MIN_CORRECTION_TIMEOUT_MS) {
      return firstBrief || fallback;
    }

    const correctionContent = await requestNvidiaChat({
      body: {
        max_tokens: 2_400,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: correctionPrompt(
              content,
              firstQuality?.reasons || ["odpowiedź nie była poprawnym JSON-em"],
            ),
          },
        ],
        temperature: 0.1,
        top_p: 0.7,
      },
      purpose: "daily-brief",
      timeoutMs: correctionTimeoutMs,
    });
    const correctedBrief = correctionContent ? parseDigestBriefJson(correctionContent, articleCount) : null;
    const correctedQuality = correctedBrief ? validateDigestBriefQuality(correctedBrief) : null;

    if (correctedBrief && correctedQuality?.valid) {
      return correctedBrief;
    }

    // The correction prompt explicitly targets clarity and language. Prefer its
    // parseable result even when it still misses a secondary length constraint.
    return correctedBrief || firstBrief || fallback;
  } catch {
    return fallback;
  }
}

export function parseArticlePreviewJson(content: string): NvidiaArticlePreview | null {
  const parsed = jsonObjectFromModelOutput(content);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const preview = parsed as Record<string, unknown>;
  const whatHappened = requiredString(preview.whatHappened);
  const whyItMatters = requiredString(preview.whyItMatters);
  const clickIf = requiredString(preview.clickIf);
  const practicalBucket = requiredString(preview.practicalBucket);
  const entities = boundedStringArray(preview.entities);
  const topics = boundedStringArray(preview.topics);

  if (!whatHappened || !whyItMatters || !clickIf || !practicalBucket) {
    return null;
  }

  return {
    clickIf,
    entities,
    practicalBucket,
    topics,
    whatHappened,
    whyItMatters,
  };
}

export async function previewArticleWithNvidia({
  summary,
  title,
}: {
  summary: string;
  title: string;
}): Promise<NvidiaArticlePreview | null> {
  try {
    const content = await requestNvidiaChat({
      body: {
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content:
              "Piszesz krótkie podglądy newsów dla prywatnego czytnika. Używaj naturalnej, prostej polszczyzny. whatHappened ma podawać obiektywny fakt bez wstępu typu „artykuł opisuje”. whyItMatters może zawierać najwyżej jeden ostrożny wniosek o prawdopodobnym wpływie, jasno oznaczony słowami „może”, „prawdopodobnie” lub „sugeruje”. Nie dopowiadaj faktów i nie odwołuj się do technicznych indeksów ani do samego tekstu źródłowego. Zwróć wyłącznie poprawny JSON, bez markdownu, komentarzy i bloków kodu.",
          },
          {
            role: "user",
            content: `Tytuł: ${title}\n\nPodsumowanie: ${summary}\n\nZwróć dokładnie ten kształt JSON z krótkimi polskimi tekstami i maksymalnie 8 zwięzłymi tematami/encjiami:\n{"whatHappened":"","whyItMatters":"","clickIf":"","practicalBucket":"","topics":[],"entities":[]}`,
          },
        ],
        temperature: 0.1,
        top_p: 0.7,
      },
      purpose: "article-preview",
    });

    return content ? parseArticlePreviewJson(content) : null;
  } catch {
    return null;
  }
}
