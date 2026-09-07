import type { Database, Json } from "../database.types";

export type DigestRun = Database["public"]["Tables"]["digest_runs"]["Row"];
export type PipelineStageRun = Database["public"]["Tables"]["pipeline_stage_runs"]["Row"];

export type StageResult = {
  complete?: boolean;
  message?: string;
  metrics?: Json;
  nextAttemptAt?: string;
  aiBrief?: { brief: Json; kind: "ai" | "fallback"; reason: string | null };
};

export type StageRunner = (context: {
  digestRunId: string;
  stage: PipelineStageRun;
  deadlineMs: number;
}) => Promise<StageResult>;
