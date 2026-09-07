import "server-only";

import { fallbackDigestBrief, generateDigestBriefWithNvidia } from "../../ai-summary";
import { materializeBrief, type BriefInputV1 } from "../../digest-brief-job";
import { createSupabaseAdminClient } from "../../supabase";
import type { StageRunner } from "../types";

const MAX_GENERATIONS = 3;

export const runAiBriefStage: StageRunner = async ({ digestRunId, stage, deadlineMs }) => {
  const supabase = createSupabaseAdminClient();
  const { data: job, error } = await supabase.from("digest_brief_jobs").select("*").eq("digest_run_id", digestRunId).single();
  if (error) throw error;
  const input = job.input_payload as unknown as BriefInputV1;
  const leaseToken = stage.lease_token;
  if (!leaseToken) throw new Error("AI stage has no lease token.");
  const fallback = materializeBrief(fallbackDigestBrief(input.articles), input);

  if (job.status === "skipped" || job.status === "fallback") {
    return { aiBrief: { brief: fallback, kind: "fallback", reason: job.reason || "skipped" } };
  }
  if (job.candidate_payload) {
    return { aiBrief: { brief: job.candidate_payload, kind: "ai", reason: null } };
  }
  const remainingMs = deadlineMs - Date.now() - 20_000;
  if (remainingMs < 10_000) return { complete: false, message: "AI briefing yielded before generation: insufficient deadline budget." };

  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: typeof job | null; error: { message: string } | null }>;
  const started = await rpc("start_digest_brief_attempt", { p_run_id: digestRunId, p_lease_token: leaseToken });
  if (started.error || !started.data) throw started.error || new Error("AI job could not start.");
  const attempt = started.data.generation_attempt_count;
  const generation = await generateDigestBriefWithNvidia({ articles: input.articles, attempt, interestProfile: input.interestProfile, timeoutMs: Math.min(60_000, remainingMs) });

  if (generation.status === "generated") {
    const candidate = materializeBrief(generation.brief, input);
    const saved = await rpc("save_digest_brief_candidate", { p_candidate: candidate, p_lease_token: leaseToken, p_model: generation.model, p_run_id: digestRunId });
    if (saved.error || !saved.data) throw saved.error || new Error("AI candidate lease was lost.");
    return { aiBrief: { brief: candidate, kind: "ai", reason: null }, metrics: { generationAttempt: attempt, model: generation.model } };
  }

  if (generation.status === "configuration_error" || attempt >= MAX_GENERATIONS) {
    return { aiBrief: { brief: fallback, kind: "fallback", reason: generation.errorCode }, metrics: { generationAttempt: attempt, model: generation.model } };
  }
  const delayMs = attempt === 1 ? 30_000 + Math.floor(Math.random() * 10_001) : 120_000 + Math.floor(Math.random() * 30_001);
  await supabase.from("digest_brief_jobs").update({ last_error_code: generation.errorCode, reason: generation.errorCode, status: "retry_wait" }).eq("digest_run_id", digestRunId).eq("status", "generating");
  return { complete: false, message: `AI briefing retry ${attempt}/${MAX_GENERATIONS} queued.`, nextAttemptAt: new Date(Date.now() + delayMs).toISOString(), metrics: { generationAttempt: attempt, model: generation.model } };
};
