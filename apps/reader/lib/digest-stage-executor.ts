import "server-only";

import { runStageForRun } from "./digest-builder/stage-registry";
import type { DigestRun, PipelineStageRun } from "./digest-builder/types";
import { errorMessage } from "./digest-builder/utils";
import { getDigestRunById, pruneCompletedDigestRuns, sortDigestStages } from "./digest-runs";
import { createSupabaseAdminClient } from "./supabase";

const RUNNING_STAGE_STALE_MS = 90_000;

export type AdvanceDigestRunResult = {
  runId: string;
  status: DigestRun["status"];
  advancedStage: PipelineStageRun["stage_name"] | null;
  message: string;
};

function runningStageIsStale(stage: PipelineStageRun, nowMs = Date.now()) {
  if (!stage.started_at) {
    return true;
  }

  const startedAtMs = Date.parse(stage.started_at);

  return Number.isNaN(startedAtMs) || nowMs - startedAtMs > RUNNING_STAGE_STALE_MS;
}

function queuedStage(stages: PipelineStageRun[]) {
  const sortedStages = sortDigestStages(stages);

  return sortedStages.find((stage) => stage.status === "queued") || null;
}

export async function advanceDigestRun(digestRunId: string): Promise<AdvanceDigestRunResult> {
  const run = await getDigestRunById(digestRunId);

  if (!run) {
    throw new Error("Digest run not found.");
  }

  if (run.status !== "queued" && run.status !== "running") {
    return {
      runId: run.id,
      status: run.status,
      advancedStage: null,
      message: `Run is already ${run.status}.`,
    };
  }

  const supabase = createSupabaseAdminClient();
  const runningStage = sortDigestStages(run.stages).find((stage) => stage.status === "running") || null;
  let stage: PipelineStageRun | null = null;

  if (runningStage && !runningStageIsStale(runningStage)) {
    return {
      runId: run.id,
      status: "running",
      advancedStage: runningStage.stage_name,
      message: `${runningStage.stage_name} is already running.`,
    };
  }

  if (runningStage) {
    const { data, error } = await supabase
      .from("pipeline_stage_runs")
      .update({
        error_message: null,
        finished_at: null,
        started_at: null,
        status: "queued",
      })
      .eq("id", runningStage.id)
      .eq("status", "running")
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    stage = data;
  }

  stage = stage || queuedStage(run.stages);

  if (!stage) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("digest_runs")
      .update({
        finished_at: now,
        status: "succeeded",
      })
      .eq("id", run.id)
      .in("status", ["queued", "running"]);

    if (error) {
      throw error;
    }

    return {
      runId: run.id,
      status: "succeeded",
      advancedStage: null,
      message: "Run finalized.",
    };
  }

  const now = new Date().toISOString();
  const { error: runError } = await supabase
    .from("digest_runs")
    .update({
      started_at: run.started_at ?? now,
      status: "running",
    })
    .eq("id", run.id)
    .in("status", ["queued", "running"]);

  if (runError) {
    throw runError;
  }

  let claimedStage: PipelineStageRun | null = stage;

  if (stage.status === "queued") {
    const { data, error: claimError } = await supabase
      .from("pipeline_stage_runs")
      .update({
        attempt_count: stage.attempt_count + 1,
        error_message: null,
        started_at: now,
        status: "running",
      })
      .eq("id", stage.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw claimError;
    }

    claimedStage = data;

    if (!claimedStage) {
      return {
        runId: run.id,
        status: "running",
        advancedStage: null,
        message: "No queued stage was claimed.",
      };
    }
  }

  try {
    const result = await runStageForRun(claimedStage, run.id);
    const finishedAt = new Date().toISOString();
    const stageComplete = result.complete !== false;
    const { error: stageError } = await supabase
      .from("pipeline_stage_runs")
      .update({
        finished_at: stageComplete ? finishedAt : null,
        metrics: result.metrics ?? {},
        status: stageComplete ? "succeeded" : "queued",
      })
      .eq("id", claimedStage.id)
      .eq("status", "running");

    if (stageError) {
      throw stageError;
    }

    if (!stageComplete) {
      return {
        runId: run.id,
        status: "running",
        advancedStage: claimedStage.stage_name,
        message: result.message || `${claimedStage.stage_name} is still running.`,
      };
    }

    if (claimedStage.stage_name === "finalization") {
      const { error: digestRunError } = await supabase
        .from("digest_runs")
        .update({
          error_message: null,
          finished_at: finishedAt,
          status: "succeeded",
        })
        .eq("id", run.id)
        .eq("status", "running");

      if (digestRunError) {
        throw digestRunError;
      }

      await pruneCompletedDigestRuns();

      return {
        runId: run.id,
        status: "succeeded",
        advancedStage: claimedStage.stage_name,
        message: "Run finalized.",
      };
    }

    return {
      runId: run.id,
      status: "running",
      advancedStage: claimedStage.stage_name,
      message: result.message || `${claimedStage.stage_name} succeeded.`,
    };
  } catch (error) {
    const message = `${claimedStage.stage_name}: ${errorMessage(error)}`;
    const finishedAt = new Date().toISOString();
    const [{ error: stageError }, { error: digestRunError }] = await Promise.all([
      supabase
        .from("pipeline_stage_runs")
        .update({
          error_message: message,
          finished_at: finishedAt,
          status: "failed",
        })
        .eq("id", claimedStage.id)
        .eq("status", "running"),
      supabase
        .from("digest_runs")
        .update({
          error_message: message,
          finished_at: finishedAt,
          status: "failed",
        })
        .eq("id", run.id)
        .eq("status", "running"),
    ]);

    if (stageError) {
      throw stageError;
    }
    if (digestRunError) {
      throw digestRunError;
    }

    return {
      runId: run.id,
      status: "failed",
      advancedStage: claimedStage.stage_name,
      message,
    };
  }
}
