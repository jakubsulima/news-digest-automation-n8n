import { createHash } from "node:crypto";

import { readerFeedForCategory } from "../feed-categories";

export type DedupeInput = {
  canonicalUrl?: string | null;
  category?: string | null;
  id: string;
  publishedAt?: string | null;
  source?: string | null;
  summary?: string | null;
  title: string;
};

export type DedupeProfile = {
  broadFeed: string;
  canonicalUrl: string;
  fingerprint: string;
  id: string;
  publishedTimestamp: number | null;
  simhash: number;
  source: string;
  textTokens: Set<string>;
  title: string;
  titleTokens: Set<string>;
};

export type DuplicateDecision = {
  duplicate: boolean;
  reason: string;
  score: number;
};

const DUPLICATE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
const SIMHASH_BITS = 32;

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "again",
  "against",
  "all",
  "amid",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "latest",
  "live",
  "new",
  "news",
  "of",
  "on",
  "or",
  "over",
  "report",
  "reports",
  "says",
  "that",
  "the",
  "this",
  "to",
  "under",
  "update",
  "updates",
  "was",
  "what",
  "when",
  "why",
  "will",
  "with",
]);

function normalizedText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeTokens(value: string) {
  return normalizedText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function stableUniqueTokens(tokens: string[]) {
  return [...new Set(tokens)].sort();
}

export function titleFingerprint(title: string) {
  return stableUniqueTokens(dedupeTokens(title)).slice(0, 12).join(" ");
}

export function tokenJaccard(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) {
    return 1;
  }

  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}

function tokenContainment(left: Set<string>, right: Set<string>) {
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;

  if (!smaller.size) {
    return 0;
  }

  let intersection = 0;

  for (const token of smaller) {
    if (larger.has(token)) {
      intersection += 1;
    }
  }

  return intersection / smaller.size;
}

function hashToken32(token: string) {
  const digest = createHash("sha256").update(token).digest();

  return digest.readUInt32BE(0);
}

export function simhash(tokens: string[]) {
  const weights = Array.from({ length: SIMHASH_BITS }, () => 0);

  for (const token of tokens) {
    const hash = hashToken32(token);

    for (let bit = 0; bit < SIMHASH_BITS; bit += 1) {
      const mask = 2 ** bit;
      weights[bit] += hash & mask ? 1 : -1;
    }
  }

  return weights.reduce((value, weight, bit) => (weight > 0 ? value + 2 ** bit : value), 0);
}

export function hammingDistance(left: number, right: number) {
  let diff = (left ^ right) >>> 0;
  let distance = 0;

  while (diff) {
    distance += diff & 1;
    diff >>>= 1;
  }

  return distance;
}

function parsedTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? null : timestamp;
}

function withinDuplicateWindow(left: DedupeProfile, right: DedupeProfile) {
  if (left.publishedTimestamp === null || right.publishedTimestamp === null) {
    return true;
  }

  return Math.abs(left.publishedTimestamp - right.publishedTimestamp) <= DUPLICATE_WINDOW_MS;
}

export function buildDedupeProfile(input: DedupeInput): DedupeProfile {
  const titleTokens = new Set(dedupeTokens(input.title));
  const textTokens = new Set(dedupeTokens(`${input.title} ${input.summary || ""}`));
  const canonicalUrl = input.canonicalUrl || "";

  return {
    broadFeed: readerFeedForCategory(input.category || "general"),
    canonicalUrl,
    fingerprint: titleFingerprint(input.title),
    id: input.id,
    publishedTimestamp: parsedTimestamp(input.publishedAt),
    simhash: simhash([...textTokens]),
    source: input.source || "",
    textTokens,
    title: input.title,
    titleTokens,
  };
}

function sharedStrongAnchorCount(left: DedupeProfile, right: DedupeProfile) {
  let count = 0;

  for (const token of left.textTokens) {
    if (right.textTokens.has(token) && (/\d/.test(token) || token.length >= 7)) {
      count += 1;
    }
  }

  return count;
}

export function duplicateDecision(left: DedupeProfile, right: DedupeProfile): DuplicateDecision {
  if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) {
    return { duplicate: true, reason: "canonical_url", score: 1 };
  }

  if (!withinDuplicateWindow(left, right)) {
    return { duplicate: false, reason: "outside_time_window", score: 0 };
  }

  const titleSimilarity = tokenJaccard(left.titleTokens, right.titleTokens);
  const textSimilarity = tokenJaccard(left.textTokens, right.textTokens);
  const titleOverlap = tokenContainment(left.titleTokens, right.titleTokens);
  const simhashSimilarity = 1 - hammingDistance(left.simhash, right.simhash) / SIMHASH_BITS;
  const anchorCount = sharedStrongAnchorCount(left, right);
  const sameFeed = left.broadFeed === right.broadFeed;
  const score = Math.max(
    titleSimilarity * 0.58 + textSimilarity * 0.27 + simhashSimilarity * 0.15,
    titleOverlap * 0.7 + textSimilarity * 0.3,
  );

  if (left.fingerprint && left.fingerprint === right.fingerprint && left.titleTokens.size >= 3) {
    return { duplicate: true, reason: "title_fingerprint", score: Math.max(score, 0.95) };
  }

  if (titleSimilarity >= 0.72 && textSimilarity >= 0.18) {
    return { duplicate: true, reason: "title_and_text_overlap", score };
  }

  if (titleOverlap >= 0.82 && textSimilarity >= 0.25) {
    return { duplicate: true, reason: "title_containment", score };
  }

  if (hammingDistance(left.simhash, right.simhash) <= 4 && textSimilarity >= 0.3) {
    return { duplicate: true, reason: "simhash", score };
  }

  if (score >= 0.58 && (sameFeed || anchorCount >= 2)) {
    return { duplicate: true, reason: "weighted_similarity", score };
  }

  if (titleSimilarity >= 0.35 && textSimilarity >= 0.22 && anchorCount >= 2) {
    return { duplicate: true, reason: "anchored_overlap", score };
  }

  return { duplicate: false, reason: "below_threshold", score };
}

export function areLikelyDuplicateStories(left: DedupeInput, right: DedupeInput) {
  return duplicateDecision(buildDedupeProfile(left), buildDedupeProfile(right)).duplicate;
}

export function storyKeyForProfiles(profiles: DedupeProfile[]) {
  const basis =
    profiles
      .map((profile) => `${profile.broadFeed}:${profile.fingerprint || profile.canonicalUrl || profile.id}`)
      .sort()[0] || "";

  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
