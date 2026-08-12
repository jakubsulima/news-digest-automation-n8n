import { describe, expect, it } from "vitest";

import { fallbackDigestBrief, parseDigestBriefJson } from "./ai-summary";
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
    expect(brief.readingTimeMinutes).toBe(2);
  });
});

describe("parseDigestBriefJson", () => {
  it("accepts a complete briefing wrapped in a markdown JSON fence", () => {
    const brief = parseDigestBriefJson(
      `\`\`\`json
      {
        "summary": "Najważniejsze procesy są ze sobą powiązane.",
        "highlights": [{"articleIndex": 0, "whatHappened": "Państwa uzgodniły zmianę.", "whyItMatters": "Wpływa na handel."}],
        "sections": [{"category": "geopolitics", "title": "Nowy układ", "situation": "Rozmowy zmieniły układ negocjacji.", "articleIndexes": [0, 1]}],
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
          articleIndexes: [0, 1],
          category: "geopolitics",
          situation: "Rozmowy zmieniły układ negocjacji.",
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
          references: [{ newsItemId: "newest", source: "Newest source", title: "Newest article" }],
          situation: "Newest summary",
          title: "Geopolityka",
        },
      ],
      summary: "Najnowszy digest obejmuje jedną wiadomość. Poniżej znajdziesz przekrojowy obraz sytuacji w dostępnych materiałach.",
      watchlist: [],
    });
  });
});
