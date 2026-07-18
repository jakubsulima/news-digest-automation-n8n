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
