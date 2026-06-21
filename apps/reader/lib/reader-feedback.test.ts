import { describe, expect, it } from "vitest";

import {
  buildFeedbackProfile,
  extractFeedbackKeywords,
  feedbackScoreAdjustment,
  parseFeedbackSentiment,
} from "./reader-feedback";

describe("reader feedback scoring", () => {
  it("parses API feedback sentiment values", () => {
    expect(parseFeedbackSentiment("more")).toBe("more");
    expect(parseFeedbackSentiment("less")).toBe("less");
    expect(parseFeedbackSentiment(null)).toBeNull();
    expect(parseFeedbackSentiment("other")).toBeUndefined();
  });

  it("extracts stable keywords from feedback text", () => {
    expect(extractFeedbackKeywords("This NVIDIA security story is about a critical supply chain breach")).toEqual([
      "nvidia",
      "security",
      "story",
      "critical",
      "supply",
      "chain",
      "breach",
    ]);
  });

  it("boosts matching source, feed, and keywords for positive feedback", () => {
    const profile = buildFeedbackProfile([
      {
        category: "AI / Open Source",
        sentiment: "more",
        source: "Hugging Face Blog",
        summary: "NVIDIA releases open model tooling",
        title: "NVIDIA model release",
      },
    ]);

    expect(
      feedbackScoreAdjustment(profile, {
        category: "AI / Biznes / Rynek",
        source: "Hugging Face Blog",
        text: "NVIDIA model demand grows in open AI tooling",
      }),
    ).toBe(16);
  });

  it("penalizes matching source, feed, and keywords for negative feedback with caps", () => {
    const profile = buildFeedbackProfile([
      {
        category: "Software / IT",
        sentiment: "less",
        source: "Example Source",
        summary: "Framework release release release release release",
        title: "Framework update",
      },
      {
        category: "Software / IT",
        sentiment: "less",
        source: "Other Source",
        summary: "Framework release update tooling",
        title: "Tooling update",
      },
    ]);

    expect(
      feedbackScoreAdjustment(profile, {
        category: "Software / Engineering",
        source: "Example Source",
        text: "Framework release update tooling notes",
      }),
    ).toBe(-29);
  });
});
