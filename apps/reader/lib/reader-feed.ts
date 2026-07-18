import "server-only";

import { READER_FEEDS, type ReaderFeedId } from "./feed-categories";
import { getReaderNewsItems } from "./news";
import { getReaderDigestSettings } from "./digest-settings";
import { buildFeedbackProfile, getFeedbackProfileForUser } from "./reader-feedback";
import {
  filterFeedItems,
  groupReaderItems,
  rankReaderItems,
  READER_RANKING_POLICY_VERSION,
  type FeedPeriod,
  type FeedSort,
} from "./reader-feed-ranking";
import { READER_VIEWS, type ReaderViewId } from "./reader-feed-filters";
import { getReaderLastVisit } from "./reader-profile";
import { READER_RECOMMENDATION_POLICY_VERSION } from "./recommendation-policy";
import { getRecommendationPolicyGate } from "./recommendation-policy-server";

export type ReaderFeedRequest = {
  cursor?: string | null;
  feed: ReaderFeedId;
  limit?: number;
  period: FeedPeriod;
  previousVisitAt?: string | null;
  rankedAt?: string | null;
  rankingContextId?: string | null;
  sort: FeedSort;
  view: ReaderViewId;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRankingSnapshot(request: Pick<ReaderFeedRequest, "cursor" | "rankedAt" | "rankingContextId">) {
  const rankedAtIsValid = Boolean(request.rankedAt && !Number.isNaN(Date.parse(request.rankedAt)));
  const canContinue = Boolean(
    request.cursor &&
    request.rankingContextId &&
    UUID_PATTERN.test(request.rankingContextId) &&
    rankedAtIsValid,
  );

  return canContinue
    ? {
        rankedAt: new Date(request.rankedAt!).toISOString(),
        rankingContextId: request.rankingContextId!,
      }
    : {
        rankedAt: new Date().toISOString(),
        rankingContextId: crypto.randomUUID(),
      };
}

export function decodeFeedCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

export function encodeFeedCursor(itemId: string) {
  return Buffer.from(itemId, "utf8").toString("base64url");
}

export async function getReaderFeedPage(userId: string, request: ReaderFeedRequest) {
  const rankingSnapshot = resolveRankingSnapshot(request);
  const [items, settings, storedPreviousVisitAt] = await Promise.all([
    getReaderNewsItems(userId),
    getReaderDigestSettings(userId),
    getReaderLastVisit(userId),
  ]);
  const profile = settings.personalizationEnabled
    ? await getFeedbackProfileForUser(userId, { includeImplicit: settings.implicitPersonalizationEnabled })
    : buildFeedbackProfile([]);
  const effectiveRecommendationPolicyMode = settings.recommendationPolicyMode === "v2" &&
    (await getRecommendationPolicyGate().catch(() => ({ passed: false }))).passed
    ? "v2"
    : settings.recommendationPolicyMode === "v1" ? "v1" : "shadow";
  const previousVisitAt = request.previousVisitAt === undefined ? storedPreviousVisitAt : request.previousVisitAt;
  const latestDigestDate = items.reduce<string | null>(
    (latest, item) => (!latest || item.digestDate > latest ? item.digestDate : latest),
    null,
  );
  const periodItems = filterFeedItems(items, {
    feed: request.feed,
    latestDigestDate,
    period: request.period,
    previousVisitAt,
    view: request.view,
  });
  const ranked = rankReaderItems(
    periodItems,
    profile,
    request.sort,
    previousVisitAt,
    Date.parse(rankingSnapshot.rankedAt),
    effectiveRecommendationPolicyMode,
  );
  const cursorId = decodeFeedCursor(request.cursor);
  const cursorIndex = cursorId ? ranked.findIndex((item) => item.id === cursorId) : -1;
  const offset = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const limit = Math.max(10, Math.min(100, request.limit || 30));
  const pageItems = ranked.slice(offset, offset + limit);
  const hasMore = offset + pageItems.length < ranked.length;

  const feedCounts = Object.fromEntries(
    READER_FEEDS.map((feed) => [feed.id, filterFeedItems(items, {
      feed: feed.id,
      latestDigestDate,
      period: request.period,
      previousVisitAt,
      view: request.view,
    }).length]),
  );
  const viewCounts = Object.fromEntries(
    READER_VIEWS.map((view) => [view.id, filterFeedItems(items, {
      feed: request.feed,
      latestDigestDate,
      period: request.period,
      previousVisitAt,
      view: view.id,
    }).length]),
  );

  return {
    feedCounts,
    grouped: groupReaderItems(pageItems),
    latestDigestDate,
    nextCursor: hasMore && pageItems.length ? encodeFeedCursor(pageItems.at(-1)!.id) : null,
    policyVersion: effectiveRecommendationPolicyMode === "v2"
      ? READER_RECOMMENDATION_POLICY_VERSION
      : READER_RANKING_POLICY_VERSION,
    previousVisitAt,
    rankedAt: rankingSnapshot.rankedAt,
    rankingContextId: rankingSnapshot.rankingContextId,
    selection: {
      feed: request.feed,
      period: request.period,
      sort: request.sort,
      view: request.view,
    },
    totalCount: ranked.length,
    viewCounts,
  };
}

export type ReaderFeedPage = Awaited<ReturnType<typeof getReaderFeedPage>>;
