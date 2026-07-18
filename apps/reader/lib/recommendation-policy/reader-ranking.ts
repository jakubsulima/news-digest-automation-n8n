import { readerScore } from "./scoring";
import type { ReaderRecommendationCandidate, ReaderRecommendationDecision } from "./types";

function timestamp(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function rankReaderRecommendations(
  candidates: ReaderRecommendationCandidate[],
  sort: "for-you" | "top" | "latest",
  dateKey: string,
) {
  const scored = candidates.map((candidate) => ({
    candidate,
    ...readerScore(
      candidate.editorialScore,
      candidate.preferenceAdjustment,
      candidate.freshness,
      candidate.update,
    ),
  }));

  let ordered = [...scored].sort((left, right) => {
    if (sort === "latest") {
      return timestamp(right.candidate.selectedAt) - timestamp(left.candidate.selectedAt) ||
        left.candidate.id.localeCompare(right.candidate.id);
    }
    if (sort === "top") {
      return right.candidate.editorialScore - left.candidate.editorialScore ||
        left.candidate.id.localeCompare(right.candidate.id);
    }
    return right.score - left.score ||
      right.candidate.editorialScore - left.candidate.editorialScore ||
      left.candidate.id.localeCompare(right.candidate.id);
  });
  const explorationIds = new Set<string>();

  if (sort === "for-you" && ordered.length >= 10) {
    const exploration = [...ordered].sort(
      (left, right) =>
        right.candidate.editorialScore - left.candidate.editorialScore ||
        stableHash(`${dateKey}:${left.candidate.id}`) - stableHash(`${dateKey}:${right.candidate.id}`),
    );
    for (let slot = 9; slot < ordered.length; slot += 10) {
      const candidate = exploration.find((item) => ordered.indexOf(item) > slot && item.preference >= 0);
      if (!candidate) continue;
      const candidateIndex = ordered.indexOf(candidate);
      [ordered[slot], ordered[candidateIndex]] = [ordered[candidateIndex], ordered[slot]];
      explorationIds.add(candidate.candidate.id);
    }
  }

  return ordered.map<ReaderRecommendationDecision>((item, modelRank) => {
    const isExploration = explorationIds.has(item.candidate.id);
    const reasons = sort === "latest"
      ? ["Most recently selected"]
      : sort === "top"
        ? [
            item.candidate.editorialScore >= 70 ? "High editorial importance" : "Editorial importance",
            item.candidate.sourceCount >= 3 ? `Confirmed by ${item.candidate.sourceCount} sources` : null,
          ].filter((reason): reason is string => Boolean(reason))
        : [
            item.preference > 0 ? "Matches your preferences" : null,
            item.preference < 0 ? "Lowered by your preferences" : null,
            item.candidate.freshness >= 9 ? "Recently selected" : null,
            item.candidate.update > 0 ? "New or materially updated since your last visit" : null,
            item.candidate.sourceCount >= 3 ? `Confirmed by ${item.candidate.sourceCount} sources` : null,
            isExploration ? "Exploration pick" : null,
          ].filter((reason): reason is string => Boolean(reason));

    const scoreComponents: Record<string, number | string | boolean> = sort === "latest"
      ? { selectedAt: item.candidate.selectedAt || "" }
      : sort === "top"
        ? { editorial: item.candidate.editorialScore }
        : {
            editorial: item.candidate.editorialScore,
            freshness: item.candidate.freshness,
            preference: item.preference,
            update: item.candidate.update,
          };

    return {
      id: item.candidate.id,
      isExploration,
      modelRank,
      preferenceAdjustment: item.preference,
      rankScore: sort === "latest" ? null : sort === "top" ? item.candidate.editorialScore : item.score,
      reasons,
      scoreComponents,
    };
  });
}
