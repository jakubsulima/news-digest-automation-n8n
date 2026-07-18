import { readerFeedForCategory, type ReaderFeedId } from "./feed-categories";

export type FeedbackSentiment = "more" | "less";
export type FeedbackReason = "topic" | "entity" | "source" | "repetitive" | "quality";

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
  weight?: number;
  origin?: "explicit" | "implicit";
};

export type FeedbackProfile = {
  evidenceCount: number;
  explicitEvidenceCount: number;
  feeds: Map<Exclude<ReaderFeedId, "all">, { more: number; less: number }>;
  implicitEvidenceCount: number;
  keywords: Map<string, { more: number; less: number }>;
  repetitiveStoryIds: Set<string>;
  sources: Map<string, { more: number; less: number }>;
};

const FEEDBACK_HALF_LIFE_DAYS = 45;
const IMPLICIT_EVENT_WEIGHTS = {
  fast_read: 0.5,
  read: 1.25,
  save: 2,
  source_open: 0.75,
} as const;
type ImplicitPreferenceEventType = keyof typeof IMPLICIT_EVENT_WEIGHTS;
type ImplicitPreferenceEvent = {
  createdAt: string;
  eventType: ImplicitPreferenceEventType;
  interactionOrigin: "direct" | "bulk" | "automatic" | null;
  sessionId: string;
  storyClusterId: string;
};
const STOP_WORDS = new Set([
  "about", "after", "also", "amid", "from", "have", "into", "more", "over", "said", "that", "their",
  "this", "with", "will", "would", "your", "oraz", "jest", "jako", "przez", "tego", "tych", "dla", "się",
]);

export function parseFeedbackSentiment(value: unknown): FeedbackSentiment | null | undefined {
  if (value === null) return null;
  return value === "more" || value === "less" ? value : undefined;
}

export function parseFeedbackReason(value: unknown): FeedbackReason | undefined {
  return value === "topic" || value === "entity" || value === "source" || value === "repetitive" || value === "quality"
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

export function implicitEventWeight(eventType: ImplicitPreferenceEventType) {
  return IMPLICIT_EVENT_WEIGHTS[eventType];
}

function strongestImplicitEvents(
  events: ImplicitPreferenceEvent[],
  keyFor: (event: ImplicitPreferenceEvent) => string,
) {
  const strongestByKey = new Map<string, ImplicitPreferenceEvent>();
  for (const event of events) {
    const key = keyFor(event);
    const existing = strongestByKey.get(key);
    if (!existing || implicitEventWeight(event.eventType) > implicitEventWeight(existing.eventType)) {
      strongestByKey.set(key, event);
    }
  }
  return [...strongestByKey.values()];
}

export function selectImplicitPreferenceEvents(events: ImplicitPreferenceEvent[]) {
  const directEvents = events.filter(
    (event) => event.interactionOrigin === null || event.interactionOrigin === "direct",
  );
  const strongestBySessionStory = strongestImplicitEvents(
    directEvents,
    (event) => `${event.sessionId}:${event.storyClusterId}`,
  );
  return strongestImplicitEvents(
    strongestBySessionStory,
    (event) => `${event.createdAt.slice(0, 10)}:${event.storyClusterId}`,
  );
}

export function buildFeedbackProfile(items: FeedbackBasis[]): FeedbackProfile {
  const profile: FeedbackProfile = {
    evidenceCount: items.length,
    explicitEvidenceCount: items.filter((item) => item.origin !== "implicit").length,
    feeds: new Map(),
    implicitEvidenceCount: items.filter((item) => item.origin === "implicit").length,
    keywords: new Map(),
    repetitiveStoryIds: new Set(),
    sources: new Map(),
  };

  for (const item of items) {
    const ageDays = item.updatedAt ? Math.max(0, (Date.now() - Date.parse(item.updatedAt)) / 86_400_000) : 0;
    const recencyWeight = Number.isFinite(ageDays) ? 0.5 ** (ageDays / FEEDBACK_HALF_LIFE_DAYS) : 1;
    const weight = recencyWeight * Math.max(0, item.weight ?? 1);
    const appliesToSource = !item.reason || item.reason === "source" || item.reason === "quality";
    const appliesToTopic = !item.reason || item.reason === "topic";
    const appliesToKeywords = appliesToTopic || item.reason === "entity";

    if (item.reason === "repetitive" && item.sentiment === "less" && item.storyClusterId) {
      profile.repetitiveStoryIds.add(item.storyClusterId);
    }
    if (appliesToSource) addCount(profile.sources, item.source.toLowerCase(), item.sentiment, weight);
    if (appliesToTopic) addCount(profile.feeds, readerFeedForCategory(item.category), item.sentiment, weight);

    if (appliesToKeywords) {
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
