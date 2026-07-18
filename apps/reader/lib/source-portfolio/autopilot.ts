export type SourcePortfolioRunSummary = {
  categoryCoverage: number;
  fetchFailureRate: number;
  runId: string;
  topPublisherConcentration: number;
  uniqueSelectedStories: number;
};

function average(runs: SourcePortfolioRunSummary[], value: (run: SourcePortfolioRunSummary) => number) {
  return runs.length ? runs.reduce((sum, run) => sum + value(run), 0) / runs.length : 0;
}

export function evaluateSourceAutopilotGate(
  automaticRuns: SourcePortfolioRunSummary[],
  baselineRuns: SourcePortfolioRunSummary[],
) {
  const latestAutomatic = automaticRuns.slice(0, 10);
  const latestBaseline = baselineRuns.slice(0, 10);
  const hasEvidence = latestAutomatic.length >= 10 && latestBaseline.length > 0;
  const automaticFailure = average(latestAutomatic, (run) => run.fetchFailureRate);
  const baselineFailure = average(latestBaseline, (run) => run.fetchFailureRate);
  const automaticCoverage = average(latestAutomatic, (run) => run.categoryCoverage);
  const baselineCoverage = average(latestBaseline, (run) => run.categoryCoverage);
  const automaticUnique = average(latestAutomatic, (run) => run.uniqueSelectedStories);
  const baselineUnique = average(latestBaseline, (run) => run.uniqueSelectedStories);
  const automaticConcentration = average(latestAutomatic, (run) => run.topPublisherConcentration);
  const baselineConcentration = average(latestBaseline, (run) => run.topPublisherConcentration);
  const criteria = {
    categoryCoverage: hasEvidence && automaticCoverage >= baselineCoverage,
    fetchFailures: hasEvidence && automaticFailure <= baselineFailure,
    publisherConcentration: hasEvidence && automaticConcentration <= baselineConcentration + 0.1,
    runCount: latestAutomatic.length >= 10,
    uniqueSelectedStories: hasEvidence && automaticUnique >= baselineUnique * 0.95,
  };

  return {
    automaticRunCount: automaticRuns.length,
    criteria,
    passed: Object.values(criteria).every(Boolean),
  };
}
