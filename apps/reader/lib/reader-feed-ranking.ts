import { readerFeedForCategory, type ReaderFeedId } from "./feed-categories";
import type { NewsItemWithState } from "./news";
import { feedbackScoreAdjustment, type FeedbackProfile } from "./reader-feedback-scoring";
import { itemMatchesReaderView, type ReaderViewId } from "./reader-feed-filters";
import {
  rankReaderRecommendations,
  READER_RECOMMENDATION_POLICY_VERSION,
  type RecommendationPolicyMode,
} from "./recommendation-policy";

export const FEED_SORTS = ["for-you", "top", "latest"] as const;
export const FEED_PERIODS = ["latest", "since-visit", "history"] as const;
export const READER_RANKING_POLICY_VERSION = "reader-ranking-v1";

export type FeedSort = (typeof FEED_SORTS)[number];
export type FeedPeriod = (typeof FEED_PERIODS)[number];

export type RankedNewsItem = NewsItemWithState & {
  isExploration: boolean;
  isNew: boolean;
  isUpdated: boolean;
  modelRank: number;
  policyVersion: string;
  rankingScoreComponents: Record<string, number | string | boolean>;
  rankScore: number | null;
  rankingReasons: string[];
};

export type GroupedReaderItems = {
  top: RankedNewsItem[];
  actionable: RankedNewsItem[];
  worthKnowing: RankedNewsItem[];
  more: RankedNewsItem[];
};

const ACTIONABLE_BUCKETS = new Set([
  "build_opportunity",
  "geopolitical_risk",
  "infrastructure_outage",
  "market_risk",
  "regulatory_risk",
  "security_risk",
]);

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

function freshnessBoost(item: NewsItemWithState, now: number) {
  const selectedAt = timestamp(item.lastSelectedAt || item.publishedAt);
  if (!selectedAt) return 0;
  const ageHours = Math.max(0, (now - selectedAt) / 3_600_000);
  return ageHours <= 6 ? 12 : ageHours <= 24 ? 9 : ageHours <= 72 ? 5 : ageHours <= 168 ? 2 : 0;
}

function updateBoost(item: NewsItemWithState, previousVisitAt: string | null) {
  if (!previousVisitAt) return item.changedFields.includes("new") ? 4 : item.changedFields.length ? 2 : 0;
  const visit = timestamp(previousVisitAt);
  if (timestamp(item.firstSelectedAt) > visit) return 8;
  if (timestamp(item.lastMaterialChangeAt) > visit) return 6;
  return 0;
}

export function normalizeFeedSort(value: string | null | undefined): FeedSort {
  return FEED_SORTS.includes(value as FeedSort) ? (value as FeedSort) : "for-you";
}

export function normalizeFeedPeriod(value: string | null | undefined): FeedPeriod {
  return FEED_PERIODS.includes(value as FeedPeriod) ? (value as FeedPeriod) : "latest";
}

function withRanking(
  item: NewsItemWithState,
  profile: FeedbackProfile,
  previousVisitAt: string | null,
  now: number,
): RankedNewsItem {
  const preference = feedbackScoreAdjustment(profile, {
    category: item.category,
    source: item.source,
    storyClusterId: item.storyClusterId,
    text: `${item.title} ${item.summary} ${item.topicTags.join(" ")} ${item.entityTags.join(" ")}`,
  });
  const freshness = freshnessBoost(item, now);
  const update = updateBoost(item, previousVisitAt);
  const visit = timestamp(previousVisitAt);
  const isNew = visit > 0 && timestamp(item.firstSelectedAt) > visit;
  const isUpdated = visit > 0 && !isNew && timestamp(item.lastMaterialChangeAt) > visit;
  const rankingReasons = [
    preference > 0 ? "Matches your preferences" : null,
    preference < 0 ? "Lowered by your preferences" : null,
    freshness >= 9 ? "Recently selected" : null,
    update > 0 ? (isNew ? "New since your last visit" : "Materially updated") : null,
    item.sourceCount >= 3 ? `Confirmed by ${item.sourceCount} sources` : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    ...item,
    isExploration: false,
    isNew,
    isUpdated,
    modelRank: -1,
    policyVersion: READER_RANKING_POLICY_VERSION,
    rankingScoreComponents: {
      editorial: item.editorialScore,
      preference,
      freshness,
      update,
    },
    rankScore: item.editorialScore + preference + freshness + update,
    rankingReasons,
  };
}

function applyExploration(items: RankedNewsItem[], dateKey: string) {
  if (items.length < 10) return items;

  const ordered = [...items];
  const exploration = [...items]
    .filter((item) => !item.rankingReasons.includes("Lowered by your preferences"))
    .sort(
      (left, right) =>
        right.editorialScore - left.editorialScore ||
        stableHash(`${dateKey}:${left.id}`) - stableHash(`${dateKey}:${right.id}`),
    );

  for (let slot = 9; slot < ordered.length; slot += 10) {
    const candidate = exploration.find((item) => ordered.indexOf(item) > slot);
    if (!candidate) continue;
    const candidateIndex = ordered.indexOf(candidate);
    [ordered[slot], ordered[candidateIndex]] = [ordered[candidateIndex], ordered[slot]];
    ordered[slot] = {
      ...ordered[slot],
      isExploration: true,
      rankingReasons: [...ordered[slot].rankingReasons, "Exploration pick"],
    };
  }

  return ordered;
}

export function rankReaderItems(
  items: NewsItemWithState[],
  profile: FeedbackProfile,
  sort: FeedSort,
  previousVisitAt: string | null,
  now = Date.now(),
  policyMode: RecommendationPolicyMode = "shadow",
) {
  const ranked = items.map((item) => withRanking(item, profile, previousVisitAt, now));
  if (policyMode === "v2") {
    const itemById = new Map(ranked.map((item) => [item.id, item]));
    return rankReaderRecommendations(
      ranked.map((item) => ({
        editorialScore: item.editorialScore,
        freshness: Number(item.rankingScoreComponents.freshness || 0),
        id: item.id,
        preferenceAdjustment: Number(item.rankingScoreComponents.preference || 0),
        selectedAt: item.lastSelectedAt || item.publishedAt,
        sourceCount: item.sourceCount,
        update: Number(item.rankingScoreComponents.update || 0),
      })),
      sort,
      new Date(now).toISOString().slice(0, 10),
    ).flatMap((decision) => {
      const item = itemById.get(decision.id);
      return item ? [{
        ...item,
        isExploration: decision.isExploration,
        modelRank: decision.modelRank,
        policyVersion: READER_RECOMMENDATION_POLICY_VERSION,
        rankingReasons: decision.reasons,
        rankingScoreComponents: decision.scoreComponents,
        rankScore: decision.rankScore,
      }] : [];
    });
  }
  let ordered: RankedNewsItem[];

  if (sort === "latest") {
    ordered = ranked.sort(
      (left, right) =>
        timestamp(right.lastSelectedAt || right.publishedAt) - timestamp(left.lastSelectedAt || left.publishedAt) ||
        left.id.localeCompare(right.id),
    ).map((item) => ({
      ...item,
      rankScore: null,
      rankingReasons: ["Most recently selected"],
      rankingScoreComponents: { selectedAt: item.lastSelectedAt || item.publishedAt || "" },
    }));
  } else if (sort === "top") {
    ordered = ranked.sort(
      (left, right) => right.editorialScore - left.editorialScore || left.id.localeCompare(right.id),
    ).map((item) => ({
      ...item,
      rankScore: item.editorialScore,
      rankingReasons: [
        item.editorialScore >= 70 ? "High editorial importance" : "Editorial importance",
        item.sourceCount >= 3 ? `Confirmed by ${item.sourceCount} sources` : null,
      ].filter((reason): reason is string => Boolean(reason)),
      rankingScoreComponents: { editorial: item.editorialScore },
    }));
  } else {
    const personalized = ranked.sort(
      (left, right) => (right.rankScore || 0) - (left.rankScore || 0) || left.id.localeCompare(right.id),
    );
    ordered = applyExploration(personalized, new Date(now).toISOString().slice(0, 10));
  }

  return ordered.map((item, modelRank) => ({ ...item, modelRank }));
}

export function filterFeedItems(
  items: NewsItemWithState[],
  options: {
    feed: ReaderFeedId;
    latestDigestDate: string | null;
    period: FeedPeriod;
    previousVisitAt: string | null;
    view: ReaderViewId;
  },
) {
  const visit = timestamp(options.previousVisitAt);
  return items.filter((item) => {
    if (options.feed !== "all" && readerFeedForCategory(item.category) !== options.feed) return false;
    if (!itemMatchesReaderView(item, options.view)) return false;
    if (options.view === "saved" || options.view === "archived") return true;
    if (options.period === "history") return true;
    if (options.period === "since-visit") {
      return visit > 0 && (timestamp(item.firstSelectedAt) > visit || timestamp(item.lastMaterialChangeAt) > visit);
    }
    return Boolean(options.latestDigestDate && item.digestDate === options.latestDigestDate);
  });
}

export function groupReaderItems(items: RankedNewsItem[]): GroupedReaderItems {
  const top = items.slice(0, 5);
  const topIds = new Set(top.map((item) => item.id));
  const actionable = items
    .filter((item) => !topIds.has(item.id) && ACTIONABLE_BUCKETS.has(item.practicalBucket || ""))
    .slice(0, 5);
  const usedIds = new Set([...topIds, ...actionable.map((item) => item.id)]);
  const remaining = items.filter((item) => !usedIds.has(item.id));

  return {
    actionable,
    more: remaining.slice(10),
    top,
    worthKnowing: remaining.slice(0, 10),
  };
}

export function priorityLabel(score: number) {
  if (score >= 85) return "Critical";
  if (score >= 70) return "Important";
  if (score >= 55) return "Useful";
  return "Background";
}
