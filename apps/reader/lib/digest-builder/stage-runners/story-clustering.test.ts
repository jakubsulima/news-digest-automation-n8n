import { describe, expect, it } from "vitest";

import { detectStoryChanges } from "./story-clustering";

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
});
