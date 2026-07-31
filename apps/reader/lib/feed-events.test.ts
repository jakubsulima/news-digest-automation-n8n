import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: null as null | ((table: string) => unknown),
  error: null as unknown,
  rows: [] as unknown[],
  options: null as { ignoreDuplicates: boolean; onConflict: string } | null,
}));

vi.mock("./supabase", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) =>
      state.from?.(table) || {
        async upsert(rows: unknown[], options: { ignoreDuplicates: boolean; onConflict: string }) {
          expect(table).toBe("reader_feed_events");
          state.rows = rows;
          state.options = options;
          return { error: state.error };
        },
      },
  }),
}));

const contextId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const storyClusterId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

describe("feed event validation", () => {
  beforeEach(() => {
    state.from = null;
    state.error = null;
    state.rows = [];
    state.options = null;
  });

  it("accepts legacy events and versioned recommendation events", async () => {
    const { parseFeedEventBatch } = await import("./feed-events");

    expect(
      parseFeedEventBatch([
        { eventType: "read", sessionId },
        {
          eventType: "impression",
          interactionOrigin: "direct",
          isExploration: false,
          modelRank: 2,
          policyVersion: "reader-ranking-v1",
          rank: 2,
          rankingContextId: contextId,
          rankScore: 0.72,
          recommendationReasons: ["High editorial importance"],
          scoreComponents: { editorial: 0.8, preference: 0.5 },
          sessionId,
          sortMode: "for-you",
          storyClusterId,
        },
      ]),
    ).toHaveLength(2);
  });

  it.each([
    [{ eventType: "unknown", sessionId }],
    [{ eventType: "read", sessionId: "not-a-uuid" }],
    [{ eventType: "impression", modelRank: -1, sessionId }],
    [{ eventType: "impression", rankScore: Number.NaN, sessionId }],
    [{ eventType: "impression", scoreComponents: [], sessionId }],
    [{ eventType: "impression", recommendationReasons: ["x".repeat(201)], sessionId }],
  ])("rejects malformed event payloads", async (events) => {
    const { parseFeedEventBatch } = await import("./feed-events");

    expect(parseFeedEventBatch(events)).toBeNull();
  });

  it("rejects oversized batches", async () => {
    const { parseFeedEventBatch } = await import("./feed-events");
    const events = Array.from({ length: 101 }, () => ({ eventType: "read", sessionId }));

    expect(parseFeedEventBatch(events)).toBeNull();
  });
});

describe("feed event persistence", () => {
  it("derives idempotency keys server-side only for attributable impressions", async () => {
    const { recordFeedEvents } = await import("./feed-events");

    await recordFeedEvents(userId, [
      {
        eventType: "impression",
        policyVersion: "reader-ranking-v1",
        rankingContextId: contextId,
        sessionId,
        storyClusterId,
      },
      {
        eventType: "read",
        interactionOrigin: "bulk",
        rankingContextId: contextId,
        sessionId,
        storyClusterId,
      },
    ]);

    expect(state.options).toEqual({ ignoreDuplicates: true, onConflict: "impression_key" });
    expect(state.rows).toEqual([
      expect.objectContaining({
        event_type: "impression",
        impression_key: `${userId}:${contextId}:${storyClusterId}`,
        policy_version: "reader-ranking-v1",
      }),
      expect.objectContaining({
        event_type: "read",
        impression_key: null,
        interaction_origin: "bulk",
      }),
    ]);
  });
});

describe("feed insight cohorts", () => {
  it("deduplicates outcomes against comparable exposures and excludes bulk actions", async () => {
    const { buildReaderFeedInsightMetrics } = await import("./feed-events");
    const base = {
      interaction_origin: "direct" as const,
      policy_version: "reader-ranking-v1",
      rank: 2,
      ranking_context_id: contextId,
      story_cluster_id: storyClusterId,
    };
    const metrics = buildReaderFeedInsightMetrics([
      { ...base, event_type: "impression" },
      { ...base, event_type: "fast_read" },
      { ...base, event_type: "source_open" },
      { ...base, event_type: "save" },
      { ...base, event_type: "read", interaction_origin: "bulk" },
      { ...base, event_type: "source_open", interaction_origin: "bulk" },
      { ...base, event_type: "source_open", ranking_context_id: "55555555-5555-4555-8555-555555555555" },
      { ...base, event_type: "source_open", policy_version: null, ranking_context_id: null },
    ]);

    expect(metrics).toMatchObject({
      impressions: 1,
      legacyEventCount: 1,
      openRate: 1,
      saveRate: 1,
      unattributedOutcomeCount: 2,
    });
    expect(metrics.rankEngagement).toEqual([{ bucket: "1–5", impressions: 1, opens: 1 }]);
    expect(metrics.policyExposureCounts).toEqual([{ count: 1, policyVersion: "reader-ranking-v1" }]);
  });

  it("loads large insight cohorts without creating oversized Supabase filters", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`);
    const feedback = ids.map((id) => ({ reason: "topic", sentiment: "less", story_cluster_id: id }));
    const olderItems = ids.map((id) => ({ id }));
    const readIds = new Set(ids.slice(0, 5));

    function query(data: unknown[] | ((selectedIds: string[]) => unknown[])) {
      let selectedIds: string[] = [];
      const builder = {
        eq: () => builder,
        gte: () => builder,
        in: (_column: string, values: string[]) => {
          if (values.length > 100) throw new Error(`oversized filter: ${values.length}`);
          selectedIds = values;
          return builder;
        },
        limit: () => builder,
        lt: () => builder,
        order: () => builder,
        select: () => builder,
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({
          data: typeof data === "function" ? data(selectedIds) : data,
          error: null,
        }).then(resolve, reject),
      };
      return builder;
    }

    state.from = (table) => {
      if (table === "reader_feed_events") return query([]);
      if (table === "reader_story_feedback") return query(feedback);
      if (table === "news_items") return query(olderItems);
      if (table === "story_clusters") {
        return query((selectedIds) => selectedIds.map((id) => ({ category: `Topic ${id}`, id, source: `Source ${id}` })));
      }
      if (table === "reader_item_states") {
        return query((selectedIds) => selectedIds
          .filter((id) => readIds.has(id))
          .map((id) => ({ archived_at: null, news_item_id: id, read_at: "2026-07-30T00:00:00.000Z" })));
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const { getReaderFeedInsights } = await import("./feed-events");

    await expect(getReaderFeedInsights(userId)).resolves.toMatchObject({
      ignoredSources: expect.any(Array),
      ignoredTopics: expect.any(Array),
      unreadAfter24Hours: 200,
    });
  });
});
