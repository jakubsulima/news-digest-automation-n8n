import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { data: [] as unknown[] | null, error: null as unknown },
  operations: [] as Array<{
    filters: Array<[string, unknown]>;
    orders: Array<[string, { ascending: boolean }]>;
    table: string;
  }>,
}));

vi.mock("./supabase", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const operation = {
        filters: [],
        orders: [],
        table,
      } as (typeof state.operations)[number];
      state.operations.push(operation);

      return {
        eq(column: string, value: unknown) {
          operation.filters.push([column, value]);
          return this;
        },
        order(column: string, options: { ascending: boolean }) {
          operation.orders.push([column, options]);
          return this;
        },
        select() {
          return this;
        },
        then(resolve: (value: typeof state.result) => void) {
          resolve(state.result);
        },
      };
    },
  }),
}));

const row = {
  category: "Software / IT",
  created_at: "2026-06-20T10:00:00.000Z",
  enabled: true,
  feed_url: "https://example.com/rss",
  id: "source-1",
  name: "Example Source",
  priority: 4,
  updated_at: "2026-06-20T10:00:00.000Z",
};

describe("reader sources", () => {
  beforeEach(() => {
    vi.resetModules();
    state.operations = [];
    state.result = { data: [], error: null };
  });

  it("loads enabled sources for a digest run from Supabase", async () => {
    state.result = { data: [row], error: null };
    const { getReaderSourcesForRun } = await import("./reader-sources");

    await expect(getReaderSourcesForRun()).resolves.toEqual([
      {
        category: "Software / IT",
        enabled: true,
        id: "source-1",
        name: "Example Source",
        priority: 4,
        url: "https://example.com/rss",
      },
    ]);
    expect(state.operations[0]).toMatchObject({
      filters: [["enabled", true]],
      orders: [
        ["priority", { ascending: false }],
        ["name", { ascending: true }],
      ],
      table: "reader_sources",
    });
  });

  it("falls back to static RSS sources when the reader_sources table is missing", async () => {
    state.result = { data: null, error: { code: "42P01", message: "missing reader_sources" } };
    const { getReaderSourcesForRun } = await import("./reader-sources");
    const sources = await getReaderSourcesForRun();

    expect(sources.length).toBeGreaterThan(1);
    expect(sources[0]).toMatchObject({
      enabled: true,
      name: "Money.pl Gospodarka",
      url: "https://www.money.pl/rss/rss-gospodarka.xml",
    });
  });
});
