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
  selection_mode: "always_on",
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
        feedType: "unknown",
        id: "source-1",
        language: "unknown",
        lastValidatedAt: null,
        name: "Example Source",
        priority: 4,
        selectionMode: "always_on",
        url: "https://example.com/rss",
        validationStatus: "unverified",
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
      name: "300Gospodarka",
      url: "https://300gospodarka.pl/feed",
    });
    expect(sources.some((source) => source.enabled === false)).toBe(false);
  });

  it("parses a batch of source edits from indexed form fields", async () => {
    const { readerSourcesFromFormData } = await import("./reader-sources");
    const formData = new FormData();

    formData.set("sourceCount", "2");
    formData.set("sources.0.id", "11111111-1111-4111-8111-111111111111");
    formData.set("sources.0.name", "Enabled Source");
    formData.set("sources.0.category", "Software / IT");
    formData.set("sources.0.url", "https://example.com/enabled.xml");
    formData.set("sources.0.priority", "5");
    formData.set("sources.0.enabled", "on");
    formData.set("sources.1.id", "22222222-2222-4222-8222-222222222222");
    formData.set("sources.1.name", "Disabled Source");
    formData.set("sources.1.category", "Security");
    formData.set("sources.1.url", "https://example.com/disabled.xml");
    formData.set("sources.1.priority", "2");

    expect(readerSourcesFromFormData(formData)).toEqual([
      {
        category: "Software / IT",
        enabled: true,
        id: "11111111-1111-4111-8111-111111111111",
        name: "Enabled Source",
        priority: 5,
        selectionMode: "always_on",
        url: "https://example.com/enabled.xml",
      },
      {
        category: "Security",
        enabled: false,
        id: "22222222-2222-4222-8222-222222222222",
        name: "Disabled Source",
        priority: 2,
        selectionMode: "blocked",
        url: "https://example.com/disabled.xml",
      },
    ]);
  });
});
