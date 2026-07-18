import "server-only";

import type { Json } from "./database.types";
import {
  evaluateRecommendationPolicyGate,
  type RecommendationFeed,
  type RecommendationGateDecision,
  type RecommendationGateRun,
  type RecommendationPolicyGate,
} from "./recommendation-policy";
import { createSupabaseAdminClient } from "./supabase";

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value: Json) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function getRecommendationPolicyGate(): Promise<RecommendationPolicyGate> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("digest_recommendation_decisions")
    .select("digest_run_id, story_cluster_id, policy_version, eligible, selected, selection_rank, score_components, recommendation_reasons, created_at")
    .in("policy_version", ["digest-selection-v1", "recommendation-policy-v2"])
    .order("created_at", { ascending: false })
    .limit(10_000);
  if (error) throw error;

  const byRun = new Map<string, RecommendationGateRun>();
  for (const row of data || []) {
    const run = byRun.get(row.digest_run_id) || { runId: row.digest_run_id, v1: [], v2: [] };
    const components = jsonRecord(row.score_components);
    const feed = typeof components.feed === "string" &&
      ["geopolitics", "business", "ai", "software", "security"].includes(components.feed)
      ? components.feed as RecommendationFeed
      : null;
    const decision: RecommendationGateDecision = {
      eligible: row.eligible,
      feed,
      recommendationReasons: stringArray(row.recommendation_reasons),
      scoreComponents: Object.fromEntries(
        Object.entries(components).filter((entry): entry is [string, number | string | boolean] =>
          typeof entry[1] === "number" || typeof entry[1] === "string" || typeof entry[1] === "boolean"),
      ),
      selected: row.selected,
      selectionRank: row.selection_rank,
      storyClusterId: row.story_cluster_id,
    };
    if (row.policy_version === "recommendation-policy-v2") run.v2.push(decision);
    else run.v1.push(decision);
    byRun.set(row.digest_run_id, run);
  }

  return evaluateRecommendationPolicyGate([...byRun.values()].slice(0, 50));
}
