import { describe, expect, it } from "vitest";

import {
  deletableExpiredNewsItemIds,
  shouldRetryAiBriefGeneration,
  deriveEntityTags,
  deriveTopicTags,
  readerExternalIdForStory,
} from "./reader-publication";

describe("durable reader publication", () => {
  it("keeps reader publication queued after retryable AI failures until the third attempt", () => {
    expect(shouldRetryAiBriefGeneration("retryable_failure", 1)).toBe(true);
    expect(shouldRetryAiBriefGeneration("retryable_failure", 2)).toBe(true);
    expect(shouldRetryAiBriefGeneration("retryable_failure", 3)).toBe(false);
    expect(shouldRetryAiBriefGeneration("generated", 1)).toBe(false);
    expect(shouldRetryAiBriefGeneration("unavailable", 1)).toBe(false);
  });

  it("uses a stable external id for recurring story clusters", () => {
    expect(readerExternalIdForStory("cluster-1")).toBe("story:cluster-1");
  });

  it("never deletes saved expired items", () => {
    expect(deletableExpiredNewsItemIds(["old", "saved"], ["saved"])).toEqual(["old"]);
  });

  it("never deletes expired items with reader notes", () => {
    expect(deletableExpiredNewsItemIds(["old", "noted"], [], ["noted"])).toEqual(["old"]);
  });

  it("provides deterministic topic and entity fallbacks without AI", () => {
    expect(deriveTopicTags("OpenAI releases developer platform", "AI / Software", "build_opportunity")).toContain("build opportunity");
    expect(deriveEntityTags("OpenAI partners with Microsoft in Warsaw")).toEqual(["OpenAI", "Microsoft", "Warsaw"]);
  });
});
