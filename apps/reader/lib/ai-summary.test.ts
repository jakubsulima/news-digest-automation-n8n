import { describe, expect, it } from "vitest";

import { fallbackDigestBrief } from "./ai-summary";
import { fallbackDigestBriefFromNews, isDigestBriefSchemaError } from "./digest-brief";

describe("fallbackDigestBrief", () => {
  it("keeps the top five digest articles available when AI is unavailable", () => {
    const brief = fallbackDigestBrief(
      Array.from({ length: 6 }, (_, index) => ({
        source: `Source ${index + 1}`,
        summary: `Summary ${index + 1}`,
        title: `Article ${index + 1}`,
      })),
    );

    expect(brief.highlights).toEqual([
      { articleIndex: 0, whyItMatters: "Ważny sygnał ze źródła Source 1." },
      { articleIndex: 1, whyItMatters: "Ważny sygnał ze źródła Source 2." },
      { articleIndex: 2, whyItMatters: "Ważny sygnał ze źródła Source 3." },
      { articleIndex: 3, whyItMatters: "Ważny sygnał ze źródła Source 4." },
      { articleIndex: 4, whyItMatters: "Ważny sygnał ze źródła Source 5." },
    ]);
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
        digestDate: "2026-07-09",
        id: "older",
        preview: null,
        source: "Older source",
        summary: "Older summary",
        title: "Older article",
        whyInteresting: null,
      },
      {
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
      digestDate: "2026-07-10",
      highlights: [
        {
          newsItemId: "newest",
          source: "Newest source",
          title: "Newest article",
          whyItMatters: "This is the key development.",
        },
      ],
      summary: "Najnowszy digest obejmuje jedną wiadomość. Poniżej znajdziesz najważniejsze informacje z tego zestawu.",
    });
  });
});
