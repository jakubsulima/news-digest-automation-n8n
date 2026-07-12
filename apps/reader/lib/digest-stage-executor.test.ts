import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineStageRun, StageResult } from "./digest-builder/types";

const state = vi.hoisted(() => ({
  getDigestRunById: vi.fn(),
  maybeSingleResults: [] as Array<{ data: PipelineStageRun | null; error: unknown }>,
  operations: [] as Array<{
    filters: Array<[string, unknown] | [string, unknown[]]>;
    payload: Record<string, unknown>;
    table: string;
  }>,
  pruneCompletedDigestRuns: vi.fn(),
  runStageForRun: vi.fn(),
}));

vi.mock("./digest-runs", () => ({
  getDigestRunById: state.getDigestRunById,
  pruneCompletedDigestRuns: state.pruneCompletedDigestRuns,
  sortDigestStages: (stages: PipelineStageRun[]) => stages,
}));

vi.mock("./digest-builder/stage-registry", () => ({
  runStageForRun: state.runStageForRun,
}));

vi.mock("./supabase", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      let currentOperation: (typeof state.operations)[number] | null = null;
      const query = {
        eq(column: string, value: unknown) {
          currentOperation?.filters.push([column, value]);
          return this;
        },
        in(column: string, values: unknown[]) {
          currentOperation?.filters.push([column, values]);
          return this;
        },
        maybeSingle() {
          return Promise.resolve(state.maybeSingleResults.shift() ?? { data: null, error: null });
        },
        select() {
          return this;
        },
        then(resolve: (value: { error: null }) => void) {
          resolve({ error: null });
        },
        update(payload: Record<string, unknown>) {
          currentOperation = {
            filters: [],
            payload,
            table,
          };
          state.operations.push(currentOperation);
          return this;
        },
      };

      return query;
    },
  }),
}));

const stageDefaults = {
  attempt_count: 0,
  created_at: "2026-06-19T09:00:00.000Z",
  digest_run_id: "run-1",
  error_message: null,
  finished_at: null,
  id: "stage-1",
  metrics: {},
  started_at: null,
  stage_name: "source_fetch",
  status: "queued",
  updated_at: "2026-06-19T09:00:00.000Z",
} satisfies Partial<PipelineStageRun>;

function stage(overrides: Partial<PipelineStageRun> = {}): PipelineStageRun {
  return {
    ...stageDefaults,
    ...overrides,
  } as PipelineStageRun;
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-06-19T09:00:00.000Z",
    error_message: null,
    finished_at: null,
    id: "run-1",
    metadata: {},
    report_date: "2026-06-19",
    stages: [stage()],
    started_at: null,
    started_by_user_id: "user-1",
    status: "queued",
    trigger_type: "manual",
    updated_at: "2026-06-19T09:00:00.000Z",
    ...overrides,
  };
}

describe("advanceDigestRun", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T10:00:00.000Z"));
    state.getDigestRunById.mockReset();
    state.maybeSingleResults = [];
    state.operations = [];
    state.pruneCompletedDigestRuns.mockReset();
    state.pruneCompletedDigestRuns.mockResolvedValue({ deletedRunCount: 0, retentionLimit: 100 });
    state.runStageForRun.mockReset();
    state.runStageForRun.mockResolvedValue({});
  });

  it("returns without running a stage for a non-active run", async () => {
    state.getDigestRunById.mockResolvedValue(run({ status: "succeeded" }));
    const { advanceDigestRun } = await import("./digest-stage-executor");

    await expect(advanceDigestRun("run-1")).resolves.toMatchObject({
      advancedStage: null,
      message: "Run is already succeeded.",
      status: "succeeded",
    });
    expect(state.runStageForRun).not.toHaveBeenCalled();
    expect(state.operations).toHaveLength(0);
  });

  it("does not claim a fresh running stage again", async () => {
    const running = stage({
      started_at: "2026-06-19T09:59:00.000Z",
      status: "running",
    });
    state.getDigestRunById.mockResolvedValue(run({ stages: [running], status: "running" }));
    const { advanceDigestRun } = await import("./digest-stage-executor");

    await expect(advanceDigestRun("run-1")).resolves.toMatchObject({
      advancedStage: null,
      message: "source_fetch is already running.",
      status: "running",
    });
    expect(state.runStageForRun).not.toHaveBeenCalled();
    expect(state.operations).toHaveLength(0);
  });

  it("requeues and claims a stale running stage", async () => {
    const stale = stage({
      attempt_count: 1,
      started_at: "2026-06-19T09:55:00.000Z",
      status: "running",
    });
    const queued = stage({ ...stale, started_at: null, status: "queued" });
    const claimed = stage({ ...stale, attempt_count: 2, started_at: "2026-06-19T10:00:00.000Z" });
    state.getDigestRunById.mockResolvedValue(run({ stages: [stale], status: "running" }));
    state.maybeSingleResults = [
      { data: queued, error: null },
      { data: claimed, error: null },
    ];
    const { advanceDigestRun } = await import("./digest-stage-executor");

    await expect(advanceDigestRun("run-1")).resolves.toMatchObject({
      advancedStage: "source_fetch",
      message: "source_fetch succeeded.",
      status: "running",
    });
    expect(state.runStageForRun).toHaveBeenCalledWith(claimed, "run-1");
    expect(state.operations.map((operation) => operation.payload.status)).toEqual([
      "queued",
      "running",
      "running",
      "succeeded",
    ]);
  });

  it("stores metrics and requeues a partial stage", async () => {
    const queued = stage();
    const claimed = stage({ started_at: "2026-06-19T10:00:00.000Z", status: "running" });
    const result: StageResult = {
      complete: false,
      message: "More work remains.",
      metrics: { pendingCount: 1 },
    };
    state.getDigestRunById.mockResolvedValue(run({ stages: [queued] }));
    state.maybeSingleResults = [{ data: claimed, error: null }];
    state.runStageForRun.mockResolvedValue(result);
    const { advanceDigestRun } = await import("./digest-stage-executor");

    await expect(advanceDigestRun("run-1")).resolves.toMatchObject({
      advancedStage: "source_fetch",
      message: "More work remains.",
      status: "running",
    });
    expect(state.operations.at(-1)?.payload).toMatchObject({
      finished_at: null,
      metrics: { pendingCount: 1 },
      status: "queued",
    });
  });

  it("marks the digest run succeeded after finalization", async () => {
    const queued = stage({ stage_name: "finalization" });
    const claimed = stage({ stage_name: "finalization", started_at: "2026-06-19T10:00:00.000Z", status: "running" });
    state.getDigestRunById.mockResolvedValue(run({ stages: [queued] }));
    state.maybeSingleResults = [{ data: claimed, error: null }];
    const { advanceDigestRun } = await import("./digest-stage-executor");

    await expect(advanceDigestRun("run-1")).resolves.toMatchObject({
      advancedStage: "finalization",
      message: "Run finalized.",
      status: "succeeded",
    });
    expect(
      state.operations.some((operation) => operation.table === "digest_runs" && operation.payload.status === "succeeded"),
    ).toBe(true);
    expect(state.pruneCompletedDigestRuns).toHaveBeenCalledOnce();
  });

  it("marks both the stage and run failed when a stage throws", async () => {
    const queued = stage();
    const claimed = stage({ started_at: "2026-06-19T10:00:00.000Z", status: "running" });
    state.getDigestRunById.mockResolvedValue(run({ stages: [queued] }));
    state.maybeSingleResults = [{ data: claimed, error: null }];
    state.runStageForRun.mockRejectedValue(new Error("boom"));
    const { advanceDigestRun } = await import("./digest-stage-executor");

    await expect(advanceDigestRun("run-1")).resolves.toMatchObject({
      advancedStage: "source_fetch",
      message: "source_fetch: boom",
      status: "failed",
    });
    expect(
      state.operations.filter((operation) => operation.payload.status === "failed").map((operation) => operation.table),
    ).toEqual(["pipeline_stage_runs", "digest_runs"]);
  });
});
