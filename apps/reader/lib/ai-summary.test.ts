import { describe, expect, it, vi } from "vitest";

import {
  fallbackDigestBrief,
  digestBriefWithNvidia,
  parseArticlePreviewJson,
  parseDigestBriefJson,
  validateDigestBriefQuality,
} from "./ai-summary";
import { fallbackDigestBriefFromNews, isDigestBriefSchemaError } from "./digest-brief";

describe("fallbackDigestBrief", () => {
  it("keeps the top five digest articles available when AI is unavailable", () => {
    const brief = fallbackDigestBrief(
      Array.from({ length: 6 }, (_, index) => ({
        category: index < 3 ? "geopolitics" : "business",
        importanceScore: 90 - index,
        publishedAt: null,
        source: `Source ${index + 1}`,
        sourceCount: 1,
        summary: `Summary ${index + 1}`,
        title: `Article ${index + 1}`,
        whyInteresting: null,
      })),
    );

    expect(brief.highlights).toEqual([
      { articleIndex: 0, whatHappened: "Summary 1", whyItMatters: "Ważny sygnał ze źródła Source 1." },
      { articleIndex: 1, whatHappened: "Summary 2", whyItMatters: "Ważny sygnał ze źródła Source 2." },
      { articleIndex: 2, whatHappened: "Summary 3", whyItMatters: "Ważny sygnał ze źródła Source 3." },
      { articleIndex: 3, whatHappened: "Summary 4", whyItMatters: "Ważny sygnał ze źródła Source 4." },
      { articleIndex: 4, whatHappened: "Summary 5", whyItMatters: "Ważny sygnał ze źródła Source 5." },
    ]);
    expect(brief.sections).toHaveLength(2);
    expect(brief.readingTimeMinutes).toBe(1);
  });
});

describe("parseDigestBriefJson", () => {
  it("accepts a complete briefing wrapped in a markdown JSON fence", () => {
    const brief = parseDigestBriefJson(
      `\`\`\`json
      {
        "summary": "Najważniejsze procesy są ze sobą powiązane.",
        "highlights": [{"articleIndex": 0, "whatHappened": "Państwa uzgodniły zmianę.", "whyItMatters": "Wpływa na handel."}],
        "sections": [{"category": "geopolitics", "title": "Nowy układ", "paragraphs": [{"text": "Rozmowy zmieniły układ negocjacji.", "articleIndexes": [0, 1, 1, 9]}]}],
        "watchlist": [{"signal": "Kolejna decyzja", "why": "Pokaże kierunek zmian.", "articleIndexes": [1]}],
        "coverageNote": "Materiały nie pokazują reakcji drugiej strony.",
        "readingTimeMinutes": 4
      }
      \`\`\``,
      2,
    );

    expect(brief).toEqual({
      coverageNote: "Materiały nie pokazują reakcji drugiej strony.",
      highlights: [
        {
          articleIndex: 0,
          whatHappened: "Państwa uzgodniły zmianę.",
          whyItMatters: "Wpływa na handel.",
        },
      ],
      readingTimeMinutes: 1,
      sections: [
        {
          category: "geopolitics",
          paragraphs: [{ articleIndexes: [0, 1], text: "Rozmowy zmieniły układ negocjacji." }],
          title: "Nowy układ",
        },
      ],
      summary: "Najważniejsze procesy są ze sobą powiązane.",
      watchlist: [
        {
          articleIndexes: [1],
          signal: "Kolejna decyzja",
          why: "Pokaże kierunek zmian.",
        },
      ],
    });
  });

  it("rejects a briefing without thematic synthesis", () => {
    expect(
      parseDigestBriefJson(
        JSON.stringify({
          coverageNote: "Brak danych.",
          highlights: [{ articleIndex: 0, whatHappened: "Fakt", whyItMatters: "Znaczenie" }],
          readingTimeMinutes: 2,
          sections: [],
          summary: "Podsumowanie",
          watchlist: [],
        }),
        1,
      ),
    ).toBeNull();
  });

  it("keeps legacy situation sections readable as one sourced paragraph", () => {
    expect(
      parseDigestBriefJson(
        JSON.stringify({
          coverageNote: "Brak danych o reakcji rynku.",
          highlights: [{ articleIndex: 0, whatHappened: "Fakt", whyItMatters: "Znaczenie" }],
          sections: [{
            articleIndexes: [0, 0, 4],
            category: "business",
            situation: "Starszy zapis sekcji pozostaje czytelny.",
            title: "Gospodarka",
          }],
          summary: "Lead starego formatu.",
          watchlist: [],
        }),
        1,
      ),
    ).toMatchObject({
      sections: [{
        paragraphs: [{ articleIndexes: [0], text: "Starszy zapis sekcji pozostaje czytelny." }],
      }],
    });
  });
});

describe("parseArticlePreviewJson", () => {
  it("accepts a preview wrapped in a markdown JSON fence", () => {
    expect(
      parseArticlePreviewJson(`
        \`\`\`json
        {"whatHappened":"Firma wydała nowy model.","whyItMatters":"Zwiększa konkurencję.","clickIf":"Jeśli śledzisz rynek AI.","practicalBucket":"product_trend","topics":["AI"],"entities":["Example"]}
        \`\`\`
      `),
    ).toEqual({
      clickIf: "Jeśli śledzisz rynek AI.",
      entities: ["Example"],
      practicalBucket: "product_trend",
      topics: ["AI"],
      whatHappened: "Firma wydała nowy model.",
      whyItMatters: "Zwiększa konkurencję.",
    });
  });
});

describe("isDigestBriefSchemaError", () => {
  it("allows older deployments to render before the digest summary migration is applied", () => {
    expect(isDigestBriefSchemaError({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isDigestBriefSchemaError({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isDigestBriefSchemaError({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("fallbackDigestBriefFromNews", () => {
  it("renders a digest brief from the newest published news when the summary table is unavailable", () => {
    const brief = fallbackDigestBriefFromNews([
      {
        category: "business",
        digestDate: "2026-07-09",
        id: "older",
        preview: null,
        source: "Older source",
        summary: "Older summary",
        title: "Older article",
        whyInteresting: null,
      },
      {
        category: "geopolitics",
        digestDate: "2026-07-10",
        id: "newest",
        preview: { whyItMatters: "This is the key development." },
        source: "Newest source",
        summary: "Newest summary",
        title: "Newest article",
        whyInteresting: null,
      },
    ]);

    expect(brief).toEqual({
      coverageNote: "Widok awaryjny bez syntezy AI — pełny kontekst znajduje się w materiałach źródłowych.",
      digestDate: "2026-07-10",
      highlights: [
        {
          newsItemId: "newest",
          source: "Newest source",
          title: "Newest article",
          whatHappened: "Newest summary",
          whyItMatters: "This is the key development.",
        },
      ],
      readingTimeMinutes: 1,
        sections: [
          {
            category: "geopolitics",
            paragraphs: [{
              references: [{ newsItemId: "newest", source: "Newest source", title: "Newest article" }],
              text: "Newest summary",
            }],
            title: "Geopolityka",
          },
      ],
      summary: "Najnowszy digest obejmuje jedną wiadomość. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.",
      watchlist: [],
    });
  });
});

describe("validateDigestBriefQuality", () => {
  it("requires a full lead, thematic sections, watch signals, and the 450-650 word range", () => {
    const brief = fallbackDigestBrief(
      Array.from({ length: 4 }, (_, index) => ({
        category: `category-${index}`,
        importanceScore: 90,
        publishedAt: null,
        source: `Source ${index}`,
        sourceCount: 1,
        summary: "Krótki materiał.",
        title: `Article ${index}`,
        whyInteresting: null,
      })),
    );

    const quality = validateDigestBriefQuality(brief);

    expect(quality.valid).toBe(false);
    expect(quality.reasons).toEqual(expect.arrayContaining([
      "lead must contain 60-90 words",
      "briefing must contain at least one concrete watchlist signal",
    ]));
  });

  it("accepts a focused 450-650 word briefing", () => {
    const words = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" ");
    const brief = parseDigestBriefJson(JSON.stringify({
      coverageNote: words("ograniczenie", 12),
      highlights: [{ articleIndex: 0, whatHappened: "Fakt", whyItMatters: "Znaczenie" }],
      sections: Array.from({ length: 4 }, (_, index) => ({
        category: `category-${index}`,
        paragraphs: [{ articleIndexes: [0], text: words(`sekcja${index}-`, 110) }],
        title: `Sekcja ${index}`,
      })),
      summary: words("lead", 75),
      watchlist: [{ articleIndexes: [0], signal: words("sygnal", 8), why: words("powod", 12) }],
    }), 1);

    expect(brief).not.toBeNull();
    expect(brief?.readingTimeMinutes).toBe(4);
    expect(validateDigestBriefQuality(brief!).valid).toBe(true);
  });

  it("rejects reader-facing content written predominantly in English", () => {
    const repeated = (word: string, count: number) => Array.from({ length: count }, () => word).join(" ");
    const brief = parseDigestBriefJson(JSON.stringify({
      coverageNote: repeated("the", 12),
      highlights: [{ articleIndex: 0, whatHappened: "The company changed its policy.", whyItMatters: "This may affect customers." }],
      sections: Array.from({ length: 4 }, (_, index) => ({
        category: `category-${index}`,
        paragraphs: [{ articleIndexes: [0], text: repeated("the", 95) }],
        title: `The section ${index}`,
      })),
      summary: repeated("the", 70),
      watchlist: [{ articleIndexes: [0], signal: repeated("the", 8), why: repeated("the", 12) }],
    }), 1);

    expect(brief).not.toBeNull();
    expect(validateDigestBriefQuality(brief!).reasons).toContain("all reader-facing text must be written in Polish");
  });
});

describe("digestBriefWithNvidia", () => {
  it("makes exactly one correction request after an incomplete first response", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    const responseContent = JSON.stringify({
      coverageNote: "Brak danych.",
      highlights: [{ articleIndex: 0, whatHappened: "Fakt", whyItMatters: "Znaczenie" }],
      sections: [{
        category: "business",
        paragraphs: [{ articleIndexes: [0], text: "Krótka sekcja." }],
        title: "Gospodarka",
      }],
      summary: "Krótki lead.",
      watchlist: [],
    });
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ choices: [{ message: { content: responseContent } }] }),
      ok: true,
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await digestBriefWithNvidia({
      articles: [{
        category: "business",
        importanceScore: 90,
        publishedAt: null,
        source: "Source",
        sourceCount: 1,
        summary: "Material",
        title: "Tytuł",
        whyInteresting: null,
      }],
      interestProfile: { feedTargets: {}, preferredKeywords: [] },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.coverageNote).toBe("Brak danych.");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("caps the combined duration of the initial and correction requests", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason || new Error("aborted")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const digestPromise = digestBriefWithNvidia({
      articles: [{
        category: "business",
        importanceScore: 90,
        publishedAt: null,
        source: "Source",
        sourceCount: 1,
        summary: "Material",
        title: "Tytuł",
        whyInteresting: null,
      }],
      interestProfile: { feedTargets: {}, preferredKeywords: [] },
    });
    const outcomePromise = Promise.race([
      digestPromise.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("deadline"), 31_000)),
    ]);

    await vi.advanceTimersByTimeAsync(31_000);
    const outcome = await outcomePromise;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();

    expect(outcome).toBe("resolved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
