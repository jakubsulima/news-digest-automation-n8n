import { describe, expect, it } from "vitest";

import type { RunArticle } from "../run-articles";
import { detectStoryChanges, sourceContributionsForGroup, sourceVariantsForGroup } from "./story-clustering";

function article(overrides: Partial<RunArticle> & Pick<RunArticle, "id" | "source" | "canonical_url">): RunArticle {
  return {
    category: "technology",
    content_mode: "readable",
    content_mode_reason: "full_written_text",
    created_at: "2026-07-13T08:00:00.000Z",
    enriched_description: "A detailed summary",
    enriched_fetched_at: "2026-07-13T08:00:00.000Z",
    enriched_text: "Detailed text",
    enriched_title: null,
    enriched_word_count: 200,
    enrichment_status: "enriched",
    first_seen_at: "2026-07-13T08:00:00.000Z",
    has_audio: false,
    has_video: false,
    last_seen_at: "2026-07-13T08:00:00.000Z",
    metadata: {},
    raw_summary: "Summary",
    title: "Story",
    updated_at: "2026-07-13T08:00:00.000Z",
    ...overrides,
  };
}

describe("story change detection", () => {
  it("marks new stories and material field changes", () => {
    const next = { canonicalTitle: "New title", source: "Source B", sourceCount: 3, summary: "New summary" };
    expect(detectStoryChanges(null, next)).toEqual(["new"]);
    expect(detectStoryChanges({ canonical_title: "Old title", latest_duplicate_count: 1, latest_summary: "Old summary", source: "Source A" }, next)).toEqual([
      "title",
      "summary",
      "canonical_source",
      "source_count",
    ]);
  });

  it("does not manufacture changes for an unchanged recurring story", () => {
    expect(
      detectStoryChanges(
        { canonical_title: "Same", latest_duplicate_count: 2, latest_summary: "Same summary", source: "Source" },
        { canonicalTitle: "Same", source: "Source", sourceCount: 2, summary: "Same summary" },
      ),
    ).toEqual([]);
  });

  it("counts distinct publishers instead of duplicate feed variants", () => {
    const variants = sourceVariantsForGroup([
      article({ canonical_url: "https://example.com/a", id: "a", metadata: { readerSourceId: "source-1", sourcePriority: 3 }, source: "Publisher" }),
      article({ canonical_url: "https://example.com/a?mirror=1", id: "b", metadata: { readerSourceId: "source-1", sourcePriority: 5 }, source: "Publisher" }),
      article({ canonical_url: "https://other.test/a", id: "c", metadata: { readerSourceId: "source-2", sourcePriority: 4 }, source: "Other" }),
    ]);

    expect(variants).toHaveLength(2);
    expect(variants.map((variant) => variant.articleId)).toEqual(["b", "c"]);
  });

  it("keeps stable source identity for canonical and confirmation contributions", () => {
    const contributions = sourceContributionsForGroup([
      article({ canonical_url: "https://canonical.test/a", id: "a", metadata: { readerSourceId: "source-1", sourcePriority: 5 }, source: "Renamed publisher" }),
      article({ canonical_url: "https://confirmation.test/a", id: "b", metadata: { readerSourceId: "source-2", sourcePriority: 3 }, source: "Confirmation" }),
    ]);

    expect(contributions).toEqual([
      { contributionType: "canonical", readerSourceId: "source-1" },
      { contributionType: "confirmation", readerSourceId: "source-2" },
    ]);
  });
});
