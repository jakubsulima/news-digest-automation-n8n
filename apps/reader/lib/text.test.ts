import { describe, expect, it } from "vitest";

import { cleanArticleSummary } from "./text";

describe("cleanArticleSummary", () => {
  it("removes Hacker News feed metadata from summaries", () => {
    expect(
      cleanArticleSummary(
        "Data centers become the face of AI backlash Article URL: https://www.axios.com/2026/06/22/ai-data-center-backlash-poll Comments URL: https://news.ycombinator.com/item?id=48627730 Points: 1 # Comments: 0",
        "Data centers become the face of AI backlash",
      ),
    ).toBe("");
  });

  it("keeps normal article summaries", () => {
    expect(cleanArticleSummary("A short article summary with useful context.", "Different title")).toBe(
      "A short article summary with useful context.",
    );
  });
});
