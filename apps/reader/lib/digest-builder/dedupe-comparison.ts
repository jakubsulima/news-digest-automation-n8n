export type DedupeProfile = {
  broadFeed: string;
  canonicalUrl: string;
  actionTokens: Set<string>;
  fingerprint: string;
  id: string;
  publishedTimestamp: number | null;
  simhash: number;
  source: string;
  numericTokens: Set<string>;
  entityTokens: Set<string>;
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
const V3_DUPLICATE_WINDOW_MS = 72 * 60 * 60 * 1000;
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

function withinV3DuplicateWindow(left: DedupeProfile, right: DedupeProfile) {
  if (left.publishedTimestamp === null || right.publishedTimestamp === null) return true;
  return Math.abs(left.publishedTimestamp - right.publishedTimestamp) <= V3_DUPLICATE_WINDOW_MS;
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

function sharedTokenCount(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

/**
 * The guarded v3 matcher keeps the complete-link requirement in the caller,
 * but adds explicit anchors for numbers, entities, and the action being
 * reported. v2 remains the compatibility rule and is always checked first.
 */
export function duplicateDecisionV3(left: DedupeProfile, right: DedupeProfile): DuplicateDecision {
  const v2 = duplicateDecision(left, right);
  if (v2.duplicate) return { ...v2, reason: `v2:${v2.reason}` };
  if (!withinV3DuplicateWindow(left, right)) return { duplicate: false, reason: "outside_v3_time_window", score: 0 };

  const sharedNumbers = sharedTokenCount(left.numericTokens, right.numericTokens);
  const sharedEntities = sharedTokenCount(left.entityTokens, right.entityTokens);
  const sharedActions = sharedTokenCount(left.actionTokens, right.actionTokens);
  const textSimilarity = tokenJaccard(left.textTokens, right.textTokens);
  const score = Math.min(1, (sharedNumbers * 0.25) + (sharedEntities * 0.2) + (sharedActions ? 0.2 : 0) + (textSimilarity * 0.35));

  if (sharedNumbers >= 1 && sharedEntities >= 1 && textSimilarity >= 0.15) {
    return { duplicate: true, reason: "v3:shared_entity_number_and_text", score };
  }
  if (sharedEntities >= 2 && sharedActions >= 1) {
    return { duplicate: true, reason: "v3:shared_entities_and_action", score };
  }

  return { duplicate: false, reason: "v3:below_threshold", score };
}
