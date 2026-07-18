import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eligibilityReasonsForStory, selectionReasonForStory } from "./editorial-scoring";

const scores = {
  actionabilityScore: 8,
  confirmationScore: 6,
  editorialScore: 74,
  impactScore: 7,
  noveltyScore: 8,
  scopeFitScore: 9,
  urgencyScore: 8,
};

describe("selectionReasonForStory", () => {
  it("builds story-specific selection reasons from the article signals", () => {
    const aiReason = selectionReasonForStory({
      bucket: "build_opportunity",
      feed: "ai",
      feedbackAdjustment: 0,
      feedAdjustment: 0,
      geopoliticsIsRelevant: false,
      isDeveloperSecurity: false,
      isMajorSecurity: false,
      scores,
      text: "OpenAI launches a new agents SDK for developer workflow automation",
    });
    const softwareReason = selectionReasonForStory({
      bucket: "build_opportunity",
      feed: "software",
      feedbackAdjustment: 0,
      feedAdjustment: 0,
      geopoliticsIsRelevant: false,
      isDeveloperSecurity: false,
      isMajorSecurity: false,
      scores,
      text: "GitHub releases an open source framework for API integration workflows",
    });

    expect(aiReason).toContain("openai");
    expect(aiReason).toContain("agents");
    expect(softwareReason).toContain("github");
    expect(softwareReason).toContain("open source");
    expect(softwareReason).not.toBe(aiReason);
  });
});

describe("eligibilityReasonsForStory", () => {
  it("records every failed gate with stable reason codes", () => {
    expect(eligibilityReasonsForStory({
      ageHours: 80,
      duplicateCount: 1,
      editorialScore: 40,
      feed: "security",
      freshnessWindowHours: 48,
      hasReadableVariant: false,
      isDeveloperSecurity: false,
      isExcluded: true,
      isMajorSecurity: false,
      minimumImportanceScore: 60,
      minimumSourceCount: 2,
      noveltyScore: 2,
      readableOnly: true,
      requireMajorSecurity: true,
    })).toEqual([
      "excluded_keyword",
      "unreadable",
      "stale",
      "insufficient_sources",
      "below_importance",
      "insufficient_novelty",
      "security_relevance",
    ]);
  });

  it("returns no reasons for an eligible candidate", () => {
    expect(eligibilityReasonsForStory({
      ageHours: 12,
      duplicateCount: 3,
      editorialScore: 80,
      feed: "ai",
      freshnessWindowHours: 48,
      hasReadableVariant: true,
      isDeveloperSecurity: false,
      isExcluded: false,
      isMajorSecurity: false,
      minimumImportanceScore: 60,
      minimumSourceCount: 2,
      noveltyScore: 7,
      readableOnly: true,
      requireMajorSecurity: true,
    })).toEqual([]);
  });
});
