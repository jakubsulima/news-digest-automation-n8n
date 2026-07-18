import { createHash } from "node:crypto";

import { readerFeedForCategory } from "../feed-categories";
import { duplicateDecision } from "./dedupe-comparison";
import type { DedupeProfile } from "./dedupe-comparison";

export { duplicateDecision, hammingDistance, tokenJaccard } from "./dedupe-comparison";
export type { DedupeProfile, DuplicateDecision } from "./dedupe-comparison";

export type DedupeInput = {
  canonicalUrl?: string | null;
  category?: string | null;
  id: string;
  publishedAt?: string | null;
  source?: string | null;
  summary?: string | null;
  title: string;
};

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


function parsedTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? null : timestamp;
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
