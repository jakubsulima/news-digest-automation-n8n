type HardEligibilityInput = {
  ageHours: number;
  duplicateCount: number;
  editorialScore: number;
  feed: string;
  freshnessWindowHours: number;
  hasReadableVariant: boolean;
  isDeveloperSecurity: boolean;
  isExcluded: boolean;
  isMajorSecurity: boolean;
  minimumImportanceScore: number;
  minimumSourceCount: number;
  noveltyScore: number;
  readableOnly: boolean;
  requireMajorSecurity: boolean;
};

const INTEREST_FALLBACK_REASONS = new Set(["below_importance", "insufficient_novelty"]);

type InterestFallbackCandidate = {
  eligibilityReasons: readonly string[];
  id: string;
};

/**
 * Candidates must be supplied in ranking order. Only editorial score and
 * novelty may be relaxed; all safety and operator-controlled gates stay hard.
 */
export function findInterestFallbackCandidateId(candidates: readonly InterestFallbackCandidate[]) {
  if (candidates.some((candidate) => candidate.eligibilityReasons.length === 0)) {
    return null;
  }

  return candidates.find(
    (candidate) =>
      candidate.eligibilityReasons.length > 0 &&
      candidate.eligibilityReasons.every((reason) => INTEREST_FALLBACK_REASONS.has(reason)),
  )?.id ?? null;
}

export function hardEligibilityReasons(input: HardEligibilityInput) {
  return [
    input.isExcluded ? "excluded_keyword" : null,
    input.readableOnly && !input.hasReadableVariant ? "unreadable" : null,
    input.ageHours > input.freshnessWindowHours ? "stale" : null,
    input.duplicateCount < input.minimumSourceCount ? "insufficient_sources" : null,
    input.editorialScore < input.minimumImportanceScore ? "below_importance" : null,
    input.noveltyScore <= 2 && !input.isMajorSecurity && input.duplicateCount < 3
      ? "insufficient_novelty"
      : null,
    input.feed === "security" &&
    input.requireMajorSecurity &&
    !input.isMajorSecurity &&
    !input.isDeveloperSecurity
      ? "security_relevance"
      : null,
  ].filter((reason): reason is string => Boolean(reason));
}
