import { describe, expect, it } from "vitest";

import { decodeFeedCursor, encodeFeedCursor, resolveRankingSnapshot } from "./reader-feed";

describe("reader feed cursor", () => {
  it("round-trips stable item ids and rejects empty cursors", () => {
    const cursor = encodeFeedCursor("f8b4a080-0e28-4a7c-b447-ecf174065c5a");
    expect(decodeFeedCursor(cursor)).toBe("f8b4a080-0e28-4a7c-b447-ecf174065c5a");
    expect(decodeFeedCursor("!!!")).toBeNull();
  });
});

describe("reader ranking snapshots", () => {
  it("rotates contexts for initial and filter requests", () => {
    const first = resolveRankingSnapshot({ cursor: null, rankedAt: null, rankingContextId: null });
    const second = resolveRankingSnapshot({
      cursor: null,
      rankedAt: first.rankedAt,
      rankingContextId: first.rankingContextId,
    });

    expect(first.rankingContextId).not.toBe(second.rankingContextId);
  });

  it("preserves a valid context and timestamp for pagination", () => {
    const rankingContextId = "11111111-1111-4111-8111-111111111111";
    const rankedAt = "2026-07-11T10:00:00.000Z";

    expect(resolveRankingSnapshot({ cursor: "cursor", rankedAt, rankingContextId })).toEqual({
      rankedAt,
      rankingContextId,
    });
  });
});
