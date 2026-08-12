import "server-only";

import { plainTextFromHtml } from "./text";

type NvidiaChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

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
  articleIndexes: number[];
  category: string;
  situation: string;
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
  watchlist: NvidiaDigestBriefWatchItem[];
};

export type DigestBriefInterestProfile = {
  feedTargets: Record<string, number>;
  preferredKeywords: string[];
};

const DEFAULT_NVIDIA_API_URL = "https://api.nvcf.nvidia.com/v2/nim/v1/generate";
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";

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
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return null;
  }

  const response = await fetch(process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_tokens: Math.max(80, Math.min(300, Math.ceil(maxChars / 3))),
      messages: [
        {
          role: "system",
          content:
            "Rewrite news summaries for a private daily digest. Keep concrete facts, names, dates, and numbers. Do not add analysis.",
        },
        {
          role: "user",
          content: `Title: ${title}\n\nSummary: ${summary}\n\nReturn one concise paragraph under ${maxChars} characters.`,
        },
      ],
      model: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
      stream: false,
      temperature: 0.2,
      top_p: 0.7,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as NvidiaChatResponse | null;
  const content = payload?.choices?.[0]?.message?.content;

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
      articleIndexes,
      category,
      situation: compactToWordLimit(categoryArticles.map((article) => article.summary).join(" "), 65),
      title: fallbackSectionTitle(category),
    };
  });
  const subject = articles.length === 1 ? "jedną wybraną wiadomość" : `${articles.length} wybranych wiadomości`;

  return {
    coverageNote: "Briefing awaryjny utworzony bez syntezy AI; sprawdź połączone materiały źródłowe.",
    highlights,
    readingTimeMinutes: Math.max(1, Math.min(5, Math.ceil(articles.length / 5))),
    sections,
    summary: `Dzisiejszy digest obejmuje ${subject}. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.`,
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
    const summary = boundedString(brief.summary, 1_000, 80);
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
      .slice(0, 5);

    const sections = brief.sections
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }

        const section = value as Record<string, unknown>;
        const category = boundedString(section.category, 80, 8);
        const title = boundedString(section.title, 120, 12);
        const situation = boundedString(section.situation, 850, 65);
        const articleIndexes = boundedArticleIndexes(section.articleIndexes, articleCount);

        return category && title && situation && articleIndexes.length
          ? { articleIndexes, category, situation, title }
          : null;
      })
      .filter((section): section is NvidiaDigestBriefSection => Boolean(section))
      .slice(0, 5);
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
    const briefingWordCount = [
      summary,
      coverageNote,
      ...highlights.flatMap((highlight) => [highlight.whatHappened, highlight.whyItMatters]),
      ...sections.map((section) => section.situation),
      ...watchlist.flatMap((item) => [item.signal, item.why]),
    ].join(" ").split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.min(5, Math.ceil(briefingWordCount / 180)));

    return highlights.length && sections.length
      ? { coverageNote, highlights, readingTimeMinutes, sections, summary, watchlist }
      : null;
  } catch {
    return null;
  }
}

export async function digestBriefWithNvidia({
  articles,
  interestProfile,
}: {
  articles: DigestBriefArticle[];
  interestProfile: DigestBriefInterestProfile;
}): Promise<NvidiaDigestBrief> {
  const fallback = fallbackDigestBrief(articles);
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey || !articles.length) {
    return fallback;
  }

  const sourceMaterial = articles
    .slice(0, 30)
    .map(
      (article, index) =>
        `[${index}] Kategoria: ${article.category}\nWażność: ${article.importanceScore}/100\nTytuł: ${article.title}\nŹródło: ${article.source} (${article.sourceCount} ${article.sourceCount === 1 ? "źródło" : "źródła"})\nPublikacja: ${article.publishedAt || "brak daty"}\nDlaczego wybrane: ${article.whyInteresting || "brak osobnej adnotacji"}\nMateriał: ${article.summary.slice(0, 900)}`,
    )
    .join("\n\n");
  const interests = Object.entries(interestProfile.feedTargets)
    .filter(([, target]) => target > 0)
    .sort(([, left], [, right]) => right - left)
    .map(([category, target]) => `${category}: ${target}`)
    .join(", ");

  try {
    const response = await fetch(process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_tokens: 1_800,
        messages: [
          {
            role: "system",
            content:
              "Jesteś redaktorem pięciominutowego briefingu sytuacyjnego dla prywatnego czytnika newsów. Syntetyzuj, łącz powiązane doniesienia i oddzielaj fakt od ostrożnego wniosku. Używaj wyłącznie informacji z materiałów. Nie dopowiadaj faktów, liczb ani tła, którego w nich nie ma. Nie powtarzaj tej samej informacji w kilku sekcjach. Pisz konkretną, naturalną polszczyzną. Zwróć wyłącznie poprawny JSON, bez markdownu.",
          },
          {
            role: "user",
            content: `Przygotuj pełny obraz sytuacji do przeczytania w maksymalnie 5 minut (około 600–850 słów łącznie). Nie twórz listy wszystkich artykułów. Grupuj fakty w rozwój sytuacji i pokaż zależności między nimi. Priorytety czytelnika: ${interests || "brak wag kategorii"}. Preferowane tematy: ${interestProfile.preferredKeywords.slice(0, 30).join(", ") || "brak"}.

Wymagania:
- summary: 3–5 zdań dających obraz dnia i dominujące zależności;
- highlights: 3–5 najważniejszych zmian; whatHappened opisuje konkretny fakt, whyItMatters jego konsekwencję; każdy element wskazuje najlepszy articleIndex;
- sections: 2–5 tematycznych syntez obejmujących wszystkie istotne materiały; situation ma przedstawiać stan, zmiany i konsekwencje, nie listę nagłówków; articleIndexes zawiera wszystkie materiały użyte w danej syntezie;
- watchlist: maksymalnie 4 konkretne sygnały, decyzje lub terminy do obserwowania wraz z powodem; nie wymyślaj dat;
- coverageNote: jedno uczciwe zdanie o tym, czego dostępne materiały nie pozwalają wiarygodnie ocenić;
- readingTimeMinutes: liczba całkowita 1–5.

Zwróć dokładnie ten kształt JSON:
{"summary":"","highlights":[{"articleIndex":0,"whatHappened":"","whyItMatters":""}],"sections":[{"category":"","title":"","situation":"","articleIndexes":[0]}],"watchlist":[{"signal":"","why":"","articleIndexes":[0]}],"coverageNote":"","readingTimeMinutes":5}

Materiały:
${sourceMaterial}`,
          },
        ],
        model: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
        stream: false,
        temperature: 0.1,
        top_p: 0.7,
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const payload = (await response.json().catch(() => null)) as NvidiaChatResponse | null;
    const content = payload?.choices?.[0]?.message?.content;

    return content ? parseDigestBriefJson(content, Math.min(articles.length, 30)) || fallback : fallback;
  } catch {
    return fallback;
  }
}

function parseStrictPreviewJson(content: string): NvidiaArticlePreview | null {
  const parsed = JSON.parse(content.trim()) as unknown;

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
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content:
              "You write concise article previews for a private news reader. Return only strict JSON with no markdown, prose, or code fences. Do not invent facts.",
          },
          {
            role: "user",
            content: `Title: ${title}\n\nSummary: ${summary}\n\nReturn exactly this JSON shape with short, plain-English strings and at most 8 concise topics/entities:\n{"whatHappened":"","whyItMatters":"","clickIf":"","practicalBucket":"","topics":[],"entities":[]}`,
          },
        ],
        model: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
        stream: false,
        temperature: 0.1,
        top_p: 0.7,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as NvidiaChatResponse | null;
    const content = payload?.choices?.[0]?.message?.content;

    return content ? parseStrictPreviewJson(content) : null;
  } catch {
    return null;
  }
}
