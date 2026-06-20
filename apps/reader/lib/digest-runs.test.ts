import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  operations: [] as Array<{
    action: "delete" | "select";
    columns?: string;
    filters: Array<[string, unknown] | [string, unknown[]]>;
    orders: Array<[string, { ascending: boolean }]>;
    range?: [number, number];
    table: string;
  }>,
  selectIdBatches: [] as string[][],
}));

vi.mock("./supabase", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      let currentOperation: (typeof state.operations)[number] | null = null;
      const query = {
        delete() {
          currentOperation = {
            action: "delete",
            filters: [],
            orders: [],
            table,
          };
          state.operations.push(currentOperation);
          return this;
        },
        in(column: string, values: unknown[]) {
          currentOperation?.filters.push([column, values]);
          return this;
        },
        order(column: string, options: { ascending: boolean }) {
          currentOperation?.orders.push([column, options]);
          return this;
        },
        range(from: number, to: number) {
          if (currentOperation) {
            currentOperation.range = [from, to];
          }

          const ids = state.selectIdBatches.shift() || [];

          return Promise.resolve({
            data: ids.map((id) => ({ id })),
            error: null,
          });
        },
        select(columns: string) {
          currentOperation = {
            action: "select",
            columns,
            filters: [],
            orders: [],
            table,
          };
          state.operations.push(currentOperation);
          return this;
        },
        then(resolve: (value: { error: null }) => void) {
          resolve({ error: null });
        },
      };

      return query;
    },
  }),
}));

describe("pruneCompletedDigestRuns", () => {
  beforeEach(() => {
    vi.resetModules();
    state.operations = [];
    state.selectIdBatches = [];
    delete process.env.DIGEST_RUN_RETENTION_LIMIT;
  });

  it("deletes completed digest runs beyond the retention limit", async () => {
    process.env.DIGEST_RUN_RETENTION_LIMIT = "2";
    state.selectIdBatches = [["run-3", "run-4"], []];
    const { pruneCompletedDigestRuns } = await import("./digest-runs");

    await expect(pruneCompletedDigestRuns()).resolves.toEqual({
      deletedRunCount: 2,
      retentionLimit: 2,
    });

    expect(state.operations).toMatchObject([
      {
        action: "select",
        columns: "id",
        filters: [["status", ["succeeded", "failed", "cancelled"]]],
        orders: [
          ["created_at", { ascending: false }],
          ["id", { ascending: false }],
        ],
        range: [2, 501],
        table: "digest_runs",
      },
      {
        action: "delete",
        filters: [
          ["id", ["run-3", "run-4"]],
          ["status", ["succeeded", "failed", "cancelled"]],
        ],
        table: "digest_runs",
      },
      {
        action: "select",
        range: [2, 501],
        table: "digest_runs",
      },
    ]);
  });
});
