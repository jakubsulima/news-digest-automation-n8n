import { readerFeedForCategory, type ReaderFeedId } from "./feed-categories";

export type FeedbackSentiment = "more" | "less";
export type FeedbackReason = "topic" | "source" | "repetitive" | "quality";

export type FeedbackBasis = {
  category: string;
  entityTags?: string[];
  reason?: FeedbackReason;
  sentiment: FeedbackSentiment;
  source: string;
  storyClusterId?: string;
  summary: string;
  title: string;
  topicTags?: string[];
  updatedAt?: string;
};

export type FeedbackProfile = {
  feeds: Map<Exclude<ReaderFeedId, "all">, { more: number; less: number }>;
  keywords: Map<string, { more: number; less: number }>;
  repetitiveStoryIds: Set<string>;
  sources: Map<string, { more: number; less: number }>;
};

const FEEDBACK_HALF_LIFE_DAYS = 45;
const STOP_WORDS = new Set([
  "about", "after", "also", "amid", "from", "have", "into", "more", "over", "said", "that", "their",
  "this", "with", "will", "would", "your", "oraz", "jest", "jako", "przez", "tego", "tych", "dla", "się",
]);

export function parseFeedbackSentiment(value: unknown): FeedbackSentiment | null | undefined {
  if (value === null) return null;
  return value === "more" || value === "less" ? value : undefined;
}

export function parseFeedbackReason(value: unknown): FeedbackReason | undefined {
  return value === "topic" || value === "source" || value === "repetitive" || value === "quality"
    ? value
    : undefined;
}

function addCount<T>(
  map: Map<T, { more: number; less: number }>,
  key: T,
  sentiment: FeedbackSentiment,
  amount = 1,
) {
  const counts = map.get(key) ?? { less: 0, more: 0 };
  counts[sentiment] += amount;
  map.set(key, counts);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function extractFeedbackKeywords(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((word) => word.length >= 4 && !STOP_WORDS.has(word)) ?? [],
    ),
  ).slice(0, 40);
}

export function buildFeedbackProfile(items: FeedbackBasis[]): FeedbackProfile {
  const profile: FeedbackProfile = {
    feeds: new Map(),
    keywords: new Map(),
    repetitiveStoryIds: new Set(),
    sources: new Map(),
  };

  for (const item of items) {
    const ageDays = item.updatedAt ? Math.max(0, (Date.now() - Date.parse(item.updatedAt)) / 86_400_000) : 0;
    const weight = Number.isFinite(ageDays) ? 0.5 ** (ageDays / FEEDBACK_HALF_LIFE_DAYS) : 1;
    const appliesToSource = !item.reason || item.reason === "source" || item.reason === "quality";
    const appliesToTopic = !item.reason || item.reason === "topic";

    if (item.reason === "repetitive" && item.sentiment === "less" && item.storyClusterId) {
      profile.repetitiveStoryIds.add(item.storyClusterId);
    }
    if (appliesToSource) addCount(profile.sources, item.source.toLowerCase(), item.sentiment, weight);
    if (appliesToTopic) addCount(profile.feeds, readerFeedForCategory(item.category), item.sentiment, weight);

    if (appliesToTopic) {
      const signals = `${item.title} ${item.summary} ${(item.topicTags || []).join(" ")} ${(item.entityTags || []).join(" ")}`;
      for (const keyword of extractFeedbackKeywords(signals)) addCount(profile.keywords, keyword, item.sentiment, weight);
    }
  }

  return profile;
}

export function feedbackScoreAdjustment(
  profile: FeedbackProfile,
  item: { category: string; source: string; storyClusterId?: string | null; text: string },
) {
  const sourceCounts = profile.sources.get(item.source.toLowerCase());
  const feedCounts = profile.feeds.get(readerFeedForCategory(item.category));
  let adjustment = item.storyClusterId && profile.repetitiveStoryIds.has(item.storyClusterId) ? -20 : 0;

  if (sourceCounts) {
    adjustment += clamp(sourceCounts.more * 5, 0, 5);
    adjustment -= clamp(sourceCounts.less * 8, 0, 8);
  }
  if (feedCounts) {
    adjustment += clamp(feedCounts.more * 3, 0, 3);
    adjustment -= clamp(feedCounts.less * 5, 0, 5);
  }

  let keywordBoost = 0;
  let keywordPenalty = 0;
  for (const keyword of extractFeedbackKeywords(item.text)) {
    const counts = profile.keywords.get(keyword);
    if (!counts) continue;
    keywordBoost += counts.more * 2;
    keywordPenalty += counts.less * 3;
  }

  return adjustment + clamp(keywordBoost, 0, 12) - clamp(keywordPenalty, 0, 16);
}
