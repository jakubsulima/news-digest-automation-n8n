import { describe, expect, it } from "vitest";

import { buildDedupeProfile } from "../digest-builder/dedupe";
import {
  COMBINED_PREFERENCE_CAP,
  DIGEST_PREFERENCE_CAP,
  evaluateRecommendationPolicyGate,
  hardEligibilityReasons,
  rankReaderRecommendations,
  READER_PREFERENCE_CAP,
  selectDigestRecommendations,
  type DigestRecommendationCandidate,
} from "./index";

function candidate(id: string, overrides: Partial<DigestRecommendationCandidate> = {}): DigestRecommendationCandidate {
  return {
    dedupeProfile: buildDedupeProfile({ id, title: `Story ${id}` }),
    eligibilityReasons: [],
    feed: "ai",
    feedAdjustment: 0,
    id,
    normalizedSource: id,
    objectiveComponents: { editorial: 60 },
    objectiveReasons: ["Objective score from editorial inputs"],
    objectiveScore: 60,
    preferenceAdjustment: 0,
    storyClusterId: id,
    ...overrides,
  };
}

describe("Recommendation Policy v2", () => {
  it("keeps personalization within the +6 and +9 caps without changing eligibility", () => {
    const ineligible = candidate("ineligible", { eligibilityReasons: ["stale"], objectiveScore: 100, preferenceAdjustment: 100 });
    const eligible = candidate("eligible", { objectiveScore: 60, preferenceAdjustment: 100 });
    const digest = selectDigestRecommendations({
      candidates: [ineligible, eligible],
      feedTargets: { ai: 1, business: 0, geopolitics: 0, security: 0, software: 0 },
      maxStoriesPerSource: 4,
      publishTopN: 1,
    });
    expect(DIGEST_PREFERENCE_CAP + READER_PREFERENCE_CAP).toBe(COMBINED_PREFERENCE_CAP);
    expect(digest.decisions.find((decision) => decision.id === "ineligible")).toMatchObject({ selected: false });
    expect(digest.decisions.find((decision) => decision.id === "eligible")?.preferenceAdjustment).toBe(6);

    const reader = rankReaderRecommendations([{
      editorialScore: 60,
      freshness: 0,
      id: "eligible",
      preferenceAdjustment: 100,
      selectedAt: null,
      sourceCount: 1,
      update: 0,
    }], "for-you", "2026-07-17");
    expect(reader[0].preferenceAdjustment).toBe(9);
  });

  it("preserves feed targets, publisher caps, duplicate suppression and deterministic ties", () => {
    const duplicate = candidate("duplicate", {
      dedupeProfile: buildDedupeProfile({ canonicalUrl: "https://same.test/story", id: "duplicate", title: "Same story" }),
      normalizedSource: "other",
    });
    const original = candidate("original", {
      dedupeProfile: buildDedupeProfile({ canonicalUrl: "https://same.test/story", id: "original", title: "Same story" }),
      objectiveScore: 70,
    });
    const options = {
      candidates: [duplicate, original, candidate("b", {
        dedupeProfile: buildDedupeProfile({ id: "b", title: "Quarterly markets outlook" }),
        feed: "business",
      })],
      feedTargets: { ai: 1, business: 1, geopolitics: 0, security: 0, software: 0 },
      maxStoriesPerSource: 1,
      publishTopN: 3,
    };
    const first = selectDigestRecommendations(options);
    const second = selectDigestRecommendations(options);
    expect(first).toEqual(second);
    expect(first.orderedSelectedIds).toEqual(["b", "original"]);
    expect(first.decisions.find((decision) => decision.id === "duplicate")?.selectionReasons)
      .toContain("duplicate_suppression");
  });

  it("records every hard eligibility failure", () => {
    expect(hardEligibilityReasons({
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
    })).toHaveLength(7);
  });

  it("requires ten paired runs and every rollout invariant", () => {
    const runs = Array.from({ length: 10 }, (_, index) => ({
      runId: `run-${index}`,
      v1: [{ eligible: true, feed: "ai" as const, recommendationReasons: ["reason"], scoreComponents: {}, selected: true, selectionRank: 0, storyClusterId: "story" }],
      v2: [{ eligible: true, feed: "ai" as const, recommendationReasons: ["reason"], scoreComponents: { deterministicTieBreak: 1 }, selected: true, selectionRank: 0, storyClusterId: "story" }],
    }));
    expect(evaluateRecommendationPolicyGate(runs)).toMatchObject({ passed: true });
    expect(evaluateRecommendationPolicyGate(runs.slice(0, 9))).toMatchObject({ passed: false });
  });
});
