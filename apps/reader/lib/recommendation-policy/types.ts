import type { DigestFeedTargets } from "../digest-settings";
import type { DedupeProfile } from "../digest-builder/dedupe";

export type RecommendationFeed = keyof DigestFeedTargets;
export type RecommendationPolicyMode = "shadow" | "v2" | "v1";

export type DigestRecommendationCandidate = {
  dedupeProfile: DedupeProfile;
  eligibilityReasons: string[];
  feed: RecommendationFeed;
  feedAdjustment: number;
  id: string;
  normalizedSource: string;
  objectiveComponents: Record<string, number>;
  objectiveReasons: string[];
  objectiveScore: number;
  preferenceAdjustment: number;
  storyClusterId: string;
};

export type DigestRecommendationDecision = {
  candidateRank: number;
  duplicateOfCandidateId: string | null;
  duplicateReason: string | null;
  duplicateScore: number | null;
  eligibilityReasons: string[];
  eligible: boolean;
  feed: RecommendationFeed;
  id: string;
  preferenceAdjustment: number;
  recommendationReasons: string[];
  score: number;
  scoreComponents: Record<string, number | string | boolean>;
  selected: boolean;
  selectionRank: number | null;
  selectionReasons: string[];
  storyClusterId: string;
};

export type DigestRecommendationInput = {
  candidates: DigestRecommendationCandidate[];
  feedTargets: DigestFeedTargets;
  maxStoriesPerSource: number;
  publishTopN: number;
};

export type ReaderRecommendationCandidate = {
  editorialScore: number;
  freshness: number;
  id: string;
  preferenceAdjustment: number;
  selectedAt: string | null;
  sourceCount: number;
  update: number;
};

export type ReaderRecommendationDecision = {
  id: string;
  isExploration: boolean;
  modelRank: number;
  preferenceAdjustment: number;
  rankScore: number | null;
  reasons: string[];
  scoreComponents: Record<string, number | string | boolean>;
};

export type RecommendationGateDecision = {
  eligible: boolean;
  feed: RecommendationFeed | null;
  recommendationReasons: string[];
  scoreComponents: Record<string, number | string | boolean>;
  selected: boolean;
  selectionRank: number | null;
  storyClusterId: string;
};

export type RecommendationGateRun = {
  runId: string;
  v1: RecommendationGateDecision[];
  v2: RecommendationGateDecision[];
};

export type RecommendationPolicyGate = {
  deterministicTieBreaks: boolean;
  eligibilityViolationCount: number;
  explanationCoverage: number;
  feedParity: boolean;
  pairedRunCount: number;
  passed: boolean;
  reasons: string[];
  top20Overlap: number;
};
