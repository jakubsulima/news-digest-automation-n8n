import type {
  RecommendationFeed,
  RecommendationGateDecision,
  RecommendationGateRun,
  RecommendationPolicyGate,
} from "./types";

const REQUIRED_SHADOW_RUNS = 10;
const MINIMUM_TOP_20_OVERLAP = 0.7;
const MINIMUM_EXPLANATION_COVERAGE = 0.95;
const FEEDS: RecommendationFeed[] = ["geopolitics", "business", "ai", "software", "security"];

function selected(decisions: RecommendationGateDecision[]) {
  return decisions
    .filter((decision) => decision.selected)
    .sort((left, right) => (left.selectionRank ?? Number.MAX_SAFE_INTEGER) - (right.selectionRank ?? Number.MAX_SAFE_INTEGER));
}

export function evaluateRecommendationPolicyGate(runs: RecommendationGateRun[]): RecommendationPolicyGate {
  const pairedRuns = runs.filter((run) => run.v1.length > 0 && run.v2.length > 0);
  let eligibilityViolationCount = 0;
  let overlapTotal = 0;
  let explanationCount = 0;
  let selectedCount = 0;
  let feedParity = true;
  let deterministicTieBreaks = true;

  for (const run of pairedRuns) {
    const v1Selected = selected(run.v1);
    const v2Selected = selected(run.v2);
    const v1Top = new Set(v1Selected.slice(0, 20).map((decision) => decision.storyClusterId));
    const v2Top = v2Selected.slice(0, 20);
    overlapTotal += v2Top.length
      ? v2Top.filter((decision) => v1Top.has(decision.storyClusterId)).length / Math.max(v1Top.size, v2Top.length)
      : v1Top.size ? 0 : 1;
    eligibilityViolationCount += v2Selected.filter((decision) => !decision.eligible).length;
    selectedCount += v2Selected.length;
    explanationCount += v2Selected.filter((decision) => decision.recommendationReasons.length > 0).length;
    deterministicTieBreaks &&= run.v2.every(
      (decision) => decision.scoreComponents.deterministicTieBreak === 1,
    );
    for (const feed of FEEDS) {
      const v1Count = v1Selected.filter((decision) => decision.feed === feed).length;
      const v2Count = v2Selected.filter((decision) => decision.feed === feed).length;
      if (Math.abs(v1Count - v2Count) > 1) feedParity = false;
    }
  }

  const top20Overlap = pairedRuns.length ? overlapTotal / pairedRuns.length : 0;
  const explanationCoverage = selectedCount ? explanationCount / selectedCount : 0;
  const reasons = [
    pairedRuns.length < REQUIRED_SHADOW_RUNS ? `${pairedRuns.length}/${REQUIRED_SHADOW_RUNS} paired shadow runs` : null,
    eligibilityViolationCount > 0 ? `${eligibilityViolationCount} hard eligibility violations` : null,
    top20Overlap < MINIMUM_TOP_20_OVERLAP ? `Top-20 overlap ${(top20Overlap * 100).toFixed(1)}%` : null,
    !feedParity ? "Feed counts differ by more than one story" : null,
    !deterministicTieBreaks ? "Deterministic tie-break evidence missing" : null,
    explanationCoverage < MINIMUM_EXPLANATION_COVERAGE
      ? `Explanation coverage ${(explanationCoverage * 100).toFixed(1)}%`
      : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    deterministicTieBreaks,
    eligibilityViolationCount,
    explanationCoverage,
    feedParity,
    pairedRunCount: pairedRuns.length,
    passed: reasons.length === 0,
    reasons,
    top20Overlap,
  };
}
