import { duplicateDecision } from "../digest-builder/dedupe-comparison";
import { digestScore } from "./scoring";
import type {
  DigestRecommendationCandidate,
  DigestRecommendationDecision,
  DigestRecommendationInput,
  RecommendationFeed,
} from "./types";

const FEED_SELECTION_ORDER: RecommendationFeed[] = ["geopolitics", "business", "ai", "software", "security"];

function recommendationReasons(
  candidate: DigestRecommendationCandidate,
  preference: number,
  score: number,
) {
  return [
    ...candidate.objectiveReasons,
    candidate.feedAdjustment > 0 ? `Objective ${candidate.feed} relevance +${candidate.feedAdjustment}` : null,
    candidate.feedAdjustment < 0 ? `Objective ${candidate.feed} relevance ${candidate.feedAdjustment}` : null,
    preference > 0 ? `Preference signal +${preference}` : null,
    preference < 0 ? `Preference signal ${preference}` : null,
    `Final score ${Number(score.toFixed(3))}`,
  ].filter((reason): reason is string => Boolean(reason));
}

export function selectDigestRecommendations(input: DigestRecommendationInput) {
  const ranked = input.candidates
    .map((candidate) => {
      const scoring = digestScore(
        candidate.objectiveScore,
        candidate.feedAdjustment,
        candidate.preferenceAdjustment,
      );
      return { candidate, ...scoring };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.objectiveScore - left.candidate.objectiveScore ||
        left.candidate.storyClusterId.localeCompare(right.candidate.storyClusterId),
    );
  const selected: typeof ranked = [];
  const selectedIds = new Set<string>();
  const selectedSourceCounts = new Map<string, number>();
  const selectedFeedCounts: Record<RecommendationFeed, number> = {
    geopolitics: 0,
    business: 0,
    ai: 0,
    software: 0,
    security: 0,
  };
  const selectionReasons = new Map<string, string[]>();
  const duplicateEvidence = new Map<
    string,
    { duplicateOfCandidateId: string; duplicateReason: string; duplicateScore: number }
  >();

  const addReason = (id: string, reason: string) => {
    const reasons = selectionReasons.get(id) || [];
    if (!reasons.includes(reason)) reasons.push(reason);
    selectionReasons.set(id, reasons);
  };

  const select = (item: (typeof ranked)[number], reason: "feed_target" | "global_rank") => {
    const candidate = item.candidate;
    if (selectedIds.has(candidate.id)) return;
    if (selectedIds.size >= input.publishTopN) {
      addReason(candidate.id, "capacity");
      return;
    }
    if (
      candidate.normalizedSource &&
      (selectedSourceCounts.get(candidate.normalizedSource) || 0) >= input.maxStoriesPerSource
    ) {
      addReason(candidate.id, "publisher_cap");
      return;
    }
    for (const selectedItem of selected) {
      const duplicate = duplicateDecision(candidate.dedupeProfile, selectedItem.candidate.dedupeProfile);
      if (!duplicate.duplicate) continue;
      duplicateEvidence.set(candidate.id, {
        duplicateOfCandidateId: selectedItem.candidate.id,
        duplicateReason: duplicate.reason,
        duplicateScore: Number(duplicate.score.toFixed(3)),
      });
      addReason(candidate.id, "duplicate_suppression");
      return;
    }
    selected.push(item);
    selectedIds.add(candidate.id);
    selectedFeedCounts[candidate.feed] += 1;
    if (candidate.normalizedSource) {
      selectedSourceCounts.set(
        candidate.normalizedSource,
        (selectedSourceCounts.get(candidate.normalizedSource) || 0) + 1,
      );
    }
    addReason(candidate.id, reason);
  };

  const eligible = ranked.filter((item) => item.candidate.eligibilityReasons.length === 0);
  for (const feed of FEED_SELECTION_ORDER) {
    for (const item of eligible.filter((candidate) => candidate.candidate.feed === feed)) {
      if (selectedFeedCounts[feed] >= input.feedTargets[feed]) break;
      select(item, "feed_target");
    }
  }
  for (const item of eligible) {
    if (selectedIds.has(item.candidate.id)) continue;
    if (item.candidate.feed === "security" && selectedFeedCounts.security >= input.feedTargets.security) {
      addReason(item.candidate.id, "security_quota");
      continue;
    }
    select(item, "global_rank");
  }

  const selectionRank = new Map(selected.map((item, index) => [item.candidate.id, index]));
  const decisions: DigestRecommendationDecision[] = ranked.map((item, candidateRank) => {
    const duplicate = duplicateEvidence.get(item.candidate.id);
    return {
      candidateRank,
      duplicateOfCandidateId: duplicate?.duplicateOfCandidateId || null,
      duplicateReason: duplicate?.duplicateReason || null,
      duplicateScore: duplicate?.duplicateScore ?? null,
      eligibilityReasons: item.candidate.eligibilityReasons,
      eligible: item.candidate.eligibilityReasons.length === 0,
      feed: item.candidate.feed,
      id: item.candidate.id,
      preferenceAdjustment: item.preference,
      recommendationReasons: recommendationReasons(item.candidate, item.preference, item.score),
      score: Number(item.score.toFixed(3)),
      scoreComponents: {
        ...item.candidate.objectiveComponents,
        deterministicTieBreak: 1,
        feed: item.candidate.feed,
        feedAdjustment: item.candidate.feedAdjustment,
        feedTarget: input.feedTargets[item.candidate.feed],
        objective: item.candidate.objectiveScore,
        preferenceAdjustment: item.preference,
      },
      selected: selectedIds.has(item.candidate.id),
      selectionRank: selectionRank.get(item.candidate.id) ?? null,
      selectionReasons: selectionReasons.get(item.candidate.id) || [],
      storyClusterId: item.candidate.storyClusterId,
    };
  });

  return {
    decisions,
    orderedSelectedIds: selected.map((item) => item.candidate.id),
    selectedFeedCounts,
    selectedIds,
  };
}
