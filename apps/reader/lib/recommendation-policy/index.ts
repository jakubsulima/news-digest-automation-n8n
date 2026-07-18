import { hardEligibilityReasons } from "./eligibility";
import { evaluateRecommendationPolicyGate } from "./gate";
import { rankReaderRecommendations } from "./reader-ranking";
import { COMBINED_PREFERENCE_CAP, DIGEST_PREFERENCE_CAP, READER_PREFERENCE_CAP } from "./scoring";
import { selectDigestRecommendations } from "./selection";

export const DIGEST_RECOMMENDATION_POLICY_VERSION = "recommendation-policy-v2";
export const READER_RECOMMENDATION_POLICY_VERSION = "reader-ranking-v2";

export {
  COMBINED_PREFERENCE_CAP,
  DIGEST_PREFERENCE_CAP,
  evaluateRecommendationPolicyGate,
  hardEligibilityReasons,
  rankReaderRecommendations,
  READER_PREFERENCE_CAP,
  selectDigestRecommendations,
};
export type {
  DigestRecommendationCandidate,
  DigestRecommendationDecision,
  DigestRecommendationInput,
  ReaderRecommendationCandidate,
  ReaderRecommendationDecision,
  RecommendationFeed,
  RecommendationGateDecision,
  RecommendationGateRun,
  RecommendationPolicyGate,
  RecommendationPolicyMode,
} from "./types";
