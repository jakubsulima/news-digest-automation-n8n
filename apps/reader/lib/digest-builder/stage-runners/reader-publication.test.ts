import { describe, expect, it } from "vitest";

import {
  deletableExpiredNewsItemIds,
  deriveEntityTags,
  deriveTopicTags,
  readerExternalIdForStory,
} from "./reader-publication";

describe("durable reader publication", () => {
  it("uses a stable external id for recurring story clusters", () => {
    expect(readerExternalIdForStory("cluster-1")).toBe("story:cluster-1");
  });

  it("never deletes saved expired items", () => {
    expect(deletableExpiredNewsItemIds(["old", "saved"], ["saved"])).toEqual(["old"]);
  });

  it("provides deterministic topic and entity fallbacks without AI", () => {
    expect(deriveTopicTags("OpenAI releases developer platform", "AI / Software", "build_opportunity")).toContain("build opportunity");
    expect(deriveEntityTags("OpenAI partners with Microsoft in Warsaw")).toEqual(["OpenAI", "Microsoft", "Warsaw"]);
  });
});
