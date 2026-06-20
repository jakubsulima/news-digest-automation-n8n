import type { Database, Json } from "../database.types";

export type DigestRun = Database["public"]["Tables"]["digest_runs"]["Row"];
export type PipelineStageRun = Database["public"]["Tables"]["pipeline_stage_runs"]["Row"];

export type StageResult = {
  complete?: boolean;
  message?: string;
  metrics?: Json;
};

export type StageRunner = (context: {
  digestRunId: string;
  stage: PipelineStageRun;
}) => Promise<StageResult>;
