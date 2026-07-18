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

export function tokenJaccard(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function tokenContainment(left: Set<string>, right: Set<string>) {
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  if (!smaller.size) return 0;
  let intersection = 0;
  for (const token of smaller) if (larger.has(token)) intersection += 1;
  return intersection / smaller.size;
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

function withinDuplicateWindow(left: DedupeProfile, right: DedupeProfile) {
  if (left.publishedTimestamp === null || right.publishedTimestamp === null) return true;
  return Math.abs(left.publishedTimestamp - right.publishedTimestamp) <= DUPLICATE_WINDOW_MS;
}

function sharedStrongAnchorCount(left: DedupeProfile, right: DedupeProfile) {
  let count = 0;
  for (const token of left.textTokens) {
    if (right.textTokens.has(token) && (/\d/.test(token) || token.length >= 7)) count += 1;
  }
  return count;
}

export function duplicateDecision(left: DedupeProfile, right: DedupeProfile): DuplicateDecision {
  if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) {
    return { duplicate: true, reason: "canonical_url", score: 1 };
  }
  if (!withinDuplicateWindow(left, right)) return { duplicate: false, reason: "outside_time_window", score: 0 };
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
  if (titleSimilarity >= 0.72 && textSimilarity >= 0.18) return { duplicate: true, reason: "title_and_text_overlap", score };
  if (titleOverlap >= 0.82 && textSimilarity >= 0.25) return { duplicate: true, reason: "title_containment", score };
  if (hammingDistance(left.simhash, right.simhash) <= 4 && textSimilarity >= 0.3) return { duplicate: true, reason: "simhash", score };
  if (score >= 0.58 && (sameFeed || anchorCount >= 2)) return { duplicate: true, reason: "weighted_similarity", score };
  if (titleSimilarity >= 0.35 && textSimilarity >= 0.22 && anchorCount >= 2) return { duplicate: true, reason: "anchored_overlap", score };
  return { duplicate: false, reason: "below_threshold", score };
}
