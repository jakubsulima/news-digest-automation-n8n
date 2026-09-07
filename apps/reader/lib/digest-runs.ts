import "server-only";

import { getWarsawDate } from "./date-utils";
import type { Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

type DigestRunRow = Database["public"]["Tables"]["digest_runs"]["Row"];
type DigestRunInsert = Database["public"]["Tables"]["digest_runs"]["Insert"];
type PipelineStageRunRow = Database["public"]["Tables"]["pipeline_stage_runs"]["Row"];
type PipelineStageRunInsert = Database["public"]["Tables"]["pipeline_stage_runs"]["Insert"];

const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;
const COMPLETED_RUN_STATUSES = ["succeeded", "failed", "cancelled"] as const;
const DEFAULT_DIGEST_RUN_RETENTION_LIMIT = 100;
const DIGEST_RUN_PRUNE_BATCH_SIZE = 500;

const V1_DIGEST_STAGE_NAMES: PipelineStageRunRow["stage_name"][] = [
  "source_fetch",
  "article_normalization",
  "story_clustering",
  "enrichment",
  "editorial_scoring",
  "reader_publication",
  "finalization",
];
const V2_DIGEST_STAGE_NAMES: PipelineStageRunRow["stage_name"][] = [
  "source_fetch", "article_normalization", "story_clustering", "enrichment", "editorial_scoring", "reader_publication", "ai_brief", "finalization",
];

export function digestPipelineVersion(metadata: Database["public"]["Tables"]["digest_runs"]["Row"]["metadata"]): 1 | 2 {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) && metadata.pipelineVersion === 2 ? 2 : 1;
}

export function digestStageNames(version: 1 | 2) {
  return version === 2 ? V2_DIGEST_STAGE_NAMES : V1_DIGEST_STAGE_NAMES;
}

type DigestRunOverview = DigestRunRow & {
  stages: PipelineStageRunRow[];
  briefJob: Pick<Database["public"]["Tables"]["digest_brief_jobs"]["Row"], "status" | "reason" | "completed_at"> | null;
};

function stageRowsForRun(digestRunId: string): PipelineStageRunInsert[] {
  return V1_DIGEST_STAGE_NAMES.map((stageName) => ({
    digest_run_id: digestRunId,
    stage_name: stageName,
    status: "queued",
  }));
}

function getDigestRunRetentionLimit() {
  const rawValue = process.env.DIGEST_RUN_RETENTION_LIMIT;

  if (!rawValue) {
    return DEFAULT_DIGEST_RUN_RETENTION_LIMIT;
  }

  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DIGEST_RUN_RETENTION_LIMIT;
}

export function sortDigestStages(stages: PipelineStageRunRow[], version: 1 | 2 = 1) {
  const stageOrder = new Map(digestStageNames(version).map((stageName, index) => [stageName, index]));
  for (const stage of stages) if (!stageOrder.has(stage.stage_name)) throw new Error(`Unsupported stage ${stage.stage_name} for pipeline v${version}.`);

  return [...stages].sort((left, right) => {
    return stageOrder.get(left.stage_name)! - stageOrder.get(right.stage_name)!;
  });
}

async function getStagesForRun(digestRunId: string, version: 1 | 2) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pipeline_stage_runs")
    .select("*")
    .eq("digest_run_id", digestRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return sortDigestStages(data || [], version);
}

async function hydrateRun(run: DigestRunRow | null): Promise<DigestRunOverview | null> {
  if (!run) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data: briefJob, error } = await supabase.from("digest_brief_jobs").select("status,reason,completed_at").eq("digest_run_id", run.id).maybeSingle();
  if (error && !["42P01", "PGRST205"].includes(error.code || "")) throw error;
  return {
    ...run,
    briefJob: briefJob || null,
    stages: await getStagesForRun(run.id, digestPipelineVersion(run.metadata)),
  };
}

export async function retryDigestBrief(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  const { data, error } = await rpc("retry_digest_brief", { p_run_id: digestRunId });
  if (error) throw error;
  if (!data) throw new Error("This briefing is not eligible for AI retry.");
  return getDigestRunById(digestRunId);
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

async function getLatestDigestRun(): Promise<DigestRunOverview | null> {
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

  const stageNames = digestStageNames(digestPipelineVersion(run.metadata));
  const failedStageIndex = stageNames.indexOf(failedStage.stage_name);
  const retryStageNames = stageNames.slice(failedStageIndex);
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

export async function pruneCompletedDigestRuns(): Promise<{ deletedRunCount: number; retentionLimit: number }> {
  const retentionLimit = getDigestRunRetentionLimit();
  const supabase = createSupabaseAdminClient();
  let deletedRunCount = 0;

  while (true) {
    const { data, error } = await supabase
      .from("digest_runs")
      .select("id")
      .in("status", [...COMPLETED_RUN_STATUSES])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(retentionLimit, retentionLimit + DIGEST_RUN_PRUNE_BATCH_SIZE - 1);

    if (error) {
      throw error;
    }

    const staleRunIds = (data || []).map((row) => row.id);

    if (staleRunIds.length === 0) {
      return { deletedRunCount, retentionLimit };
    }

    const { error: deleteError } = await supabase
      .from("digest_runs")
      .delete()
      .in("id", staleRunIds)
      .in("status", [...COMPLETED_RUN_STATUSES]);

    if (deleteError) {
      throw deleteError;
    }

    deletedRunCount += staleRunIds.length;
  }
}

export async function startOrGetActiveDigestRun(userId: string): Promise<DigestRunOverview> {
  const activeRun = await getActiveDigestRun();

  if (activeRun) {
    return activeRun;
  }

  await pruneCompletedDigestRuns();

  const supabase = createSupabaseAdminClient();
  const enableV2 = process.env.DIGEST_PIPELINE_V2_ENABLED === "true";
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: DigestRunRow | null; error: { code?: string; message: string } | null }>;
  const created = await rpc("create_or_get_digest_run_v2", { p_enable_v2: enableV2, p_report_date: getWarsawDate(), p_user_id: userId });
  if (!created.error && created.data) {
    const hydrated = await hydrateRun(created.data);
    if (!hydrated) throw new Error("Digest run was created but could not be loaded.");
    return hydrated;
  }
  if (enableV2) throw created.error || new Error("Could not atomically create v2 digest run.");
  const run: DigestRunInsert = {
    report_date: getWarsawDate(),
    trigger_type: "manual",
    status: "queued",
    started_by_user_id: userId,
    metadata: {
      pipelineVersion: 1,
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
