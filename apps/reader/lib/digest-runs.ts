import "server-only";

import type { Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

type DigestRunRow = Database["public"]["Tables"]["digest_runs"]["Row"];
type DigestRunInsert = Database["public"]["Tables"]["digest_runs"]["Insert"];
type PipelineStageRunRow = Database["public"]["Tables"]["pipeline_stage_runs"]["Row"];
type PipelineStageRunInsert = Database["public"]["Tables"]["pipeline_stage_runs"]["Insert"];

const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;

export const DIGEST_STAGE_NAMES: PipelineStageRunRow["stage_name"][] = [
  "source_fetch",
  "article_normalization",
  "story_clustering",
  "enrichment",
  "editorial_scoring",
  "reader_publication",
  "finalization",
];

export type DigestRunOverview = DigestRunRow & {
  stages: PipelineStageRunRow[];
};

function getWarsawDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Warsaw",
    year: "numeric",
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function stageRowsForRun(digestRunId: string): PipelineStageRunInsert[] {
  return DIGEST_STAGE_NAMES.map((stageName) => ({
    digest_run_id: digestRunId,
    stage_name: stageName,
    status: "queued",
  }));
}

export function sortDigestStages(stages: PipelineStageRunRow[]) {
  const stageOrder = new Map(DIGEST_STAGE_NAMES.map((stageName, index) => [stageName, index]));

  return [...stages].sort((left, right) => {
    return (stageOrder.get(left.stage_name) ?? 0) - (stageOrder.get(right.stage_name) ?? 0);
  });
}

async function getStagesForRun(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pipeline_stage_runs")
    .select("*")
    .eq("digest_run_id", digestRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return sortDigestStages(data || []);
}

async function hydrateRun(run: DigestRunRow | null): Promise<DigestRunOverview | null> {
  if (!run) {
    return null;
  }

  return {
    ...run,
    stages: await getStagesForRun(run.id),
  };
}

export async function getActiveDigestRun(): Promise<DigestRunOverview | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("digest_runs")
    .select("*")
    .in("status", [...ACTIVE_RUN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return hydrateRun(data);
}

export async function getLatestDigestRun(): Promise<DigestRunOverview | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("digest_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return hydrateRun(data);
}

export async function getDigestRunById(digestRunId: string): Promise<DigestRunOverview | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("digest_runs").select("*").eq("id", digestRunId).maybeSingle();

  if (error) {
    throw error;
  }

  return hydrateRun(data);
}

export async function getDigestRunStatus(): Promise<DigestRunOverview | null> {
  return (await getActiveDigestRun()) || getLatestDigestRun();
}

export async function retryFailedDigestRun(digestRunId: string): Promise<DigestRunOverview | null> {
  const run = await getDigestRunById(digestRunId);

  if (!run || run.status !== "failed") {
    return run;
  }

  const failedStage = run.stages.find((stage) => stage.status === "failed");

  if (!failedStage) {
    return run;
  }

  const failedStageIndex = DIGEST_STAGE_NAMES.indexOf(failedStage.stage_name);
  const retryStageNames = DIGEST_STAGE_NAMES.slice(failedStageIndex);
  const supabase = createSupabaseAdminClient();
  const { error: runError } = await supabase
    .from("digest_runs")
    .update({
      error_message: null,
      finished_at: null,
      status: "queued",
    })
    .eq("id", run.id);

  if (runError) {
    throw runError;
  }

  const { error: stageError } = await supabase
    .from("pipeline_stage_runs")
    .update({
      error_message: null,
      finished_at: null,
      metrics: {},
      started_at: null,
      status: "queued",
    })
    .eq("digest_run_id", run.id)
    .in("stage_name", retryStageNames);

  if (stageError) {
    throw stageError;
  }

  return getDigestRunById(run.id);
}

export async function resetDigestRun(digestRunId?: string): Promise<DigestRunOverview | null> {
  const run = digestRunId ? await getDigestRunById(digestRunId) : (await getActiveDigestRun()) || (await getLatestDigestRun());

  if (!run || run.status === "cancelled" || run.status === "succeeded") {
    return run;
  }

  const now = new Date().toISOString();
  const supabase = createSupabaseAdminClient();
  const { error: runError } = await supabase
    .from("digest_runs")
    .update({
      error_message: null,
      finished_at: now,
      status: "cancelled",
    })
    .eq("id", run.id);

  if (runError) {
    throw runError;
  }

  const { error: stageError } = await supabase
    .from("pipeline_stage_runs")
    .update({
      error_message: null,
      finished_at: now,
      status: "skipped",
    })
    .eq("digest_run_id", run.id)
    .in("status", ["queued", "running", "failed"]);

  if (stageError) {
    throw stageError;
  }

  return getDigestRunById(run.id);
}

export async function startOrGetActiveDigestRun(userId: string): Promise<DigestRunOverview> {
  const activeRun = await getActiveDigestRun();

  if (activeRun) {
    return activeRun;
  }

  const supabase = createSupabaseAdminClient();
  const run: DigestRunInsert = {
    report_date: getWarsawDate(),
    trigger_type: "manual",
    status: "queued",
    started_by_user_id: userId,
    metadata: {
      version: 1,
    },
  };

  const { data, error } = await supabase.from("digest_runs").insert(run).select("*").single();

  if (error) {
    if (error.code === "23505") {
      const existingRun = await getActiveDigestRun();
      if (existingRun) {
        return existingRun;
      }
    }

    throw error;
  }

  const { error: stageError } = await supabase
    .from("pipeline_stage_runs")
    .upsert(stageRowsForRun(data.id), { onConflict: "digest_run_id,stage_name" });

  if (stageError) {
    throw stageError;
  }

  const hydrated = await hydrateRun(data);
  if (!hydrated) {
    throw new Error("Digest run was created but could not be loaded.");
  }

  return hydrated;
}
