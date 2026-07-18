import { readerFeedForCategory, type ReaderFeedId } from "../feed-categories";
import type { SourcePortfolioDecision, SourcePortfolioInput } from "./types";

const POLICY_VERSION = "source-portfolio-v1";
type ContentFeed = Exclude<ReaderFeedId, "all">;

function scoreSource(source: SourcePortfolioInput["sources"][number], categoryNeed: number) {
  const metrics = source.metrics;
  const rawScore =
    metrics.reliability * 0.2 +
    metrics.freshYield * 0.1 +
    metrics.uniqueYield * 0.2 +
    metrics.confirmationValue * 0.15 +
    metrics.selectionValue * 0.1 +
    metrics.readerValue * 0.15 +
    categoryNeed * 0.1 -
    metrics.redundancyPenalty -
    metrics.fetchPenalty;
  const confidence = Math.min(1, metrics.runCount / 10);
  const score = confidence * rawScore + (1 - confidence) * 50;

  return {
    confidence,
    score: Number(score.toFixed(3)),
    scoreComponents: {
      categoryNeed,
      confirmationValue: metrics.confirmationValue,
      fetchPenalty: metrics.fetchPenalty,
      freshYield: metrics.freshYield,
      healthyProbeCount: metrics.healthyProbeCount,
      rawScore: Number(rawScore.toFixed(3)),
      readerValue: metrics.readerValue,
      redundancyPenalty: metrics.redundancyPenalty,
      reliability: metrics.reliability,
      runCount: metrics.runCount,
      selectionValue: metrics.selectionValue,
      uniqueYield: metrics.uniqueYield,
    },
  };
}

function applyAutomaticChangeLimit(
  desired: Set<string>,
  previous: Set<string> | undefined,
  sources: SourcePortfolioInput["sources"],
  maxChangeRatio: number,
) {
  if (!previous?.size) return desired;
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const actual = new Set(
    [...previous].filter((sourceId) => sourceById.get(sourceId)?.selectionMode !== "blocked"),
  );
  for (const source of sources) {
    if (source.selectionMode === "always_on") actual.add(source.id);
  }

  const allowedChanges = Math.max(1, Math.floor(previous.size * maxChangeRatio));
  const changes = [
    ...[...desired].filter((sourceId) => !actual.has(sourceId)).map((sourceId) => ({ add: true, sourceId })),
    ...[...actual]
      .filter((sourceId) => !desired.has(sourceId) && sourceById.get(sourceId)?.selectionMode === "auto")
      .map((sourceId) => ({ add: false, sourceId })),
  ];
  for (const change of changes.slice(0, allowedChanges)) {
    if (change.add) actual.add(change.sourceId);
    else actual.delete(change.sourceId);
  }
  return actual;
}

export function buildSourcePortfolio(input: SourcePortfolioInput) {
  const feeds: ContentFeed[] = ["geopolitics", "business", "ai", "software", "security"];
  const selected = new Set(input.sources.filter((source) => source.selectionMode === "always_on").map((source) => source.id));
  const scored = input.sources.map((source) => {
    const feed = readerFeedForCategory(source.category);
    const selectedInFeed = input.sources.filter(
      (candidate) => selected.has(candidate.id) && readerFeedForCategory(candidate.category) === feed,
    ).length;
    const categoryNeed = selectedInFeed < input.categoryMinimums[feed] ? 100 : 40;
    return { feed, source, ...scoreSource(source, categoryNeed) };
  });
  const autoByScore = scored
    .filter(({ source }) => source.selectionMode === "auto")
    .sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id));

  for (const feed of feeds) {
    const minimum = input.categoryMinimums[feed];
    const candidates = autoByScore.filter((candidate) => candidate.feed === feed);
    for (const candidate of candidates) {
      const current = input.sources.filter(
        (source) => selected.has(source.id) && readerFeedForCategory(source.category) === feed,
      ).length;
      if (current >= minimum) break;
      selected.add(candidate.source.id);
    }
  }

  for (const candidate of autoByScore) {
    if (selected.size >= Math.max(input.sourceBudget - input.explorationCount, 0)) break;
    selected.add(candidate.source.id);
  }

  const explorationIds = new Set(
    autoByScore
      .filter((candidate) => !selected.has(candidate.source.id) && candidate.source.metrics.healthyProbeCount >= 3)
      .sort((left, right) => left.confidence - right.confidence || right.score - left.score)
      .slice(0, input.explorationCount)
      .map((candidate) => candidate.source.id),
  );
  for (const sourceId of explorationIds) selected.add(sourceId);

  const actualSelected = input.mode === "automatic"
    ? applyAutomaticChangeLimit(selected, input.previousSelectedIds, input.sources, input.maxChangeRatio)
    : new Set(
        input.sources
          .filter((source) => source.selectionMode === "always_on" || (source.enabled && source.selectionMode !== "blocked"))
          .map((source) => source.id),
      );
  if (input.mode === "automatic") {
    for (const feed of feeds) {
      const minimum = input.categoryMinimums[feed];
      for (const candidate of autoByScore.filter((item) => item.feed === feed && selected.has(item.source.id))) {
        const current = input.sources.filter(
          (source) => actualSelected.has(source.id) && readerFeedForCategory(source.category) === feed,
        ).length;
        if (current >= minimum) break;
        actualSelected.add(candidate.source.id);
      }
    }
  }
  const probeIds = new Set(
    input.mode === "automatic"
      ? autoByScore
          .filter((candidate) => !actualSelected.has(candidate.source.id) && candidate.confidence < 0.3)
          .slice(0, input.probeCount)
          .map((candidate) => candidate.source.id)
      : [],
  );
  const scoredById = new Map(scored.map((source) => [source.source.id, source]));
  const decisions: SourcePortfolioDecision[] = input.sources.map((source) => {
    const score = scoredById.get(source.id)!;
    const isActual = actualSelected.has(source.id);
    const role = isActual
      ? explorationIds.has(source.id) && input.mode === "automatic" ? "explore" : "selected"
      : probeIds.has(source.id) ? "probe" : "skipped";
    const reasons = [
      source.selectionMode === "always_on" ? "Always on" : null,
      source.selectionMode === "blocked" ? "Blocked by operator" : null,
      selected.has(source.id) && score.scoreComponents.categoryNeed === 100 ? `Fills ${score.feed} minimum` : null,
      explorationIds.has(source.id) ? "Reserved exploration slot" : null,
      probeIds.has(source.id) ? "Low-evidence probe" : null,
      input.mode !== "automatic" && source.enabled !== selected.has(source.id) ? "Shadow proposal differs from legacy input" : null,
    ].filter((reason): reason is string => Boolean(reason));

    return {
      actualSelected: isActual,
      confidence: score.confidence,
      legacyEnabled: source.enabled,
      proposedSelected: selected.has(source.id),
      reasons: reasons.length ? reasons : ["Ranked by marginal source utility"],
      role,
      score: score.score,
      scoreComponents: score.scoreComponents,
      sourceId: source.id,
    };
  });

  return { decisions, policyVersion: POLICY_VERSION };
}
