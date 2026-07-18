import "server-only";

import type { Database, Json } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

type Observation = Pick<
  Database["public"]["Tables"]["source_run_observations"]["Row"],
  | "confirmation_story_count"
  | "eligible_item_count"
  | "parsed_item_count"
  | "selected_story_count"
  | "reader_source_id"
  | "source_name"
  | "source_url"
  | "status"
  | "unique_story_count"
>;

type SourceValueEvent = Pick<
  Database["public"]["Tables"]["reader_feed_events"]["Row"],
  "event_type" | "interaction_origin" | "metadata" | "story_cluster_id"
>;
type StorySource = Pick<
  Database["public"]["Tables"]["story_cluster_sources"]["Row"],
  "contribution_type" | "reader_source_id" | "story_cluster_id"
>;

export type SourceQualityInsight = {
  confirmationValue: number;
  freshYield: number;
  label: "Collecting data" | "Reliable" | "Often selected" | "Useful confirmation" | "Low fresh yield" | "Often unavailable" | "Needs review";
  readerValue: number;
  recommendation: "keep" | "review" | "consider_pausing";
  reliability: number;
  runCount: number;
  selectionValue: number;
  uniqueYield: number;
};

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round(Math.min(1, numerator / denominator) * 100) : 0;
}

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function readerValueBySourceIdentity(events: SourceValueEvent[], storySources: StorySource[]) {
  const sourceIdsByStory = new Map<string, string[]>();
  const canonicalSourceIdByStory = new Map<string, string>();
  for (const source of storySources) {
    sourceIdsByStory.set(source.story_cluster_id, [
      ...(sourceIdsByStory.get(source.story_cluster_id) || []),
      source.reader_source_id,
    ]);
    if (source.contribution_type === "canonical") {
      canonicalSourceIdByStory.set(source.story_cluster_id, source.reader_source_id);
    }
  }

  const values = new Map<string, number>();
  const addValue = (sourceId: string, value: number) =>
    values.set(sourceId, (values.get(sourceId) || 0) + value);

  for (const event of events) {
    if (event.interaction_origin === "bulk" || event.interaction_origin === "automatic") continue;
    const metadata = jsonRecord(event.metadata);
    const targetSourceId = typeof metadata.readerSourceId === "string" ? metadata.readerSourceId : null;
    const storySourceIds = event.story_cluster_id ? sourceIdsByStory.get(event.story_cluster_id) || [] : [];

    if (event.event_type === "source_open") {
      const sourceId = targetSourceId || (event.story_cluster_id ? canonicalSourceIdByStory.get(event.story_cluster_id) : null);
      if (sourceId) addValue(sourceId, 1);
      continue;
    }

    if (event.event_type === "feedback" && metadata.reason === "source") {
      const sourceId = targetSourceId || (event.story_cluster_id ? canonicalSourceIdByStory.get(event.story_cluster_id) : null);
      if (sourceId) addValue(sourceId, metadata.feedback === "less" ? -2 : 2);
      continue;
    }

    const totalValue = event.event_type === "save" ? 3 : event.event_type === "read" ? 2 : 0;
    if (!totalValue || !storySourceIds.length) continue;
    const dividedValue = totalValue / storySourceIds.length;
    for (const sourceId of storySourceIds) addValue(sourceId, dividedValue);
  }

  return values;
}

export function sourceQualityFromObservations(observations: Observation[], readerValueCount = 0): SourceQualityInsight {
  const runCount = observations.length;
  const succeeded = observations.filter((observation) => observation.status === "succeeded").length;
  const parsed = observations.reduce((sum, observation) => sum + observation.parsed_item_count, 0);
  const eligible = observations.reduce((sum, observation) => sum + observation.eligible_item_count, 0);
  const unique = observations.reduce((sum, observation) => sum + observation.unique_story_count, 0);
  const selected = observations.reduce((sum, observation) => sum + observation.selected_story_count, 0);
  const confirmed = observations.reduce((sum, observation) => sum + observation.confirmation_story_count, 0);
  const reliability = percentage(succeeded, runCount);
  const freshYield = percentage(eligible, parsed);
  const uniqueYield = percentage(unique, eligible);
  const selectionValue = percentage(selected, unique);
  const confirmationValue = percentage(confirmed, unique);
  const readerValue = Math.max(0, Math.min(100, Math.round((readerValueCount / Math.max(1, selected)) * 25)));
  let label: SourceQualityInsight["label"] = "Needs review";

  if (runCount < 5) label = "Collecting data";
  else if (reliability < 75) label = "Often unavailable";
  else if (freshYield < 10) label = "Low fresh yield";
  else if (selectionValue >= 35) label = "Often selected";
  else if (confirmationValue >= 35) label = "Useful confirmation";
  else if (reliability >= 95) label = "Reliable";

  return {
    confirmationValue,
    freshYield,
    label,
    readerValue,
    recommendation: runCount >= 8 && reliability < 40 ? "consider_pausing" : label === "Needs review" || label === "Low fresh yield" || label === "Often unavailable" ? "review" : "keep",
    reliability,
    runCount,
    selectionValue,
    uniqueYield,
  };
}

export async function getSourceQualityInsights(userId: string) {
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: observations, error: observationError }, { data: events, error: eventError }] = await Promise.all([
    supabase.from("source_run_observations").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }).limit(5_000),
    supabase
      .from("reader_feed_events")
      .select("story_cluster_id, event_type, interaction_origin, metadata")
      .eq("user_id", userId)
      .in("event_type", ["source_open", "read", "save", "feedback"])
      .not("story_cluster_id", "is", null)
      .gte("created_at", cutoff)
      .limit(2_000),
  ]);
  if (observationError) throw observationError;
  if (eventError) throw eventError;

  const storyClusterIds = [...new Set((events || []).flatMap((event) => event.story_cluster_id ? [event.story_cluster_id] : []))];
  const storySources: StorySource[] = [];
  for (let index = 0; index < storyClusterIds.length; index += 40) {
    const { data, error } = await supabase
      .from("story_cluster_sources")
      .select("story_cluster_id, reader_source_id, contribution_type")
      .in("story_cluster_id", storyClusterIds.slice(index, index + 40));
    if (error) throw error;
    storySources.push(...(data || []));
  }
  const readerValueBySource = readerValueBySourceIdentity(events || [], storySources);

  const bySource = new Map<string, Observation[]>();
  for (const observation of observations || []) {
    const key = observation.reader_source_id ? `id:${observation.reader_source_id}` : `url:${observation.source_url}`;
    bySource.set(key, [...(bySource.get(key) || []), observation]);
  }

  const insights = new Map<string, SourceQualityInsight>();
  for (const rows of bySource.values()) {
    const sourceId = rows[0]?.reader_source_id;
    const insight = sourceQualityFromObservations(rows, sourceId ? readerValueBySource.get(sourceId) || 0 : 0);
    if (sourceId) insights.set(sourceId, insight);
    for (const row of rows) insights.set(row.source_url, insight);
  }
  return insights;
}
