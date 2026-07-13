import "server-only";

import type { Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

type Observation = Pick<
  Database["public"]["Tables"]["source_run_observations"]["Row"],
  | "confirmation_story_count"
  | "eligible_item_count"
  | "parsed_item_count"
  | "selected_story_count"
  | "source_name"
  | "source_url"
  | "status"
  | "unique_story_count"
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
  const readerValue = Math.min(100, Math.round((readerValueCount / Math.max(1, selected)) * 25));
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
      .select("news_item_id, event_type")
      .eq("user_id", userId)
      .in("event_type", ["source_open", "read", "save"])
      .not("news_item_id", "is", null)
      .gte("created_at", cutoff)
      .limit(2_000),
  ]);
  if (observationError) throw observationError;
  if (eventError) throw eventError;

  const newsItemIds = [...new Set((events || []).flatMap((event) => event.news_item_id ? [event.news_item_id] : []))];
  const sourceByNewsItemId = new Map<string, string>();
  for (let index = 0; index < newsItemIds.length; index += 40) {
    const { data, error } = await supabase
      .from("news_items")
      .select("id, source")
      .in("id", newsItemIds.slice(index, index + 40));
    if (error) throw error;
    for (const item of data || []) sourceByNewsItemId.set(item.id, item.source.trim().toLocaleLowerCase("und"));
  }

  const readerValueBySource = new Map<string, number>();
  for (const event of events || []) {
    if (!event.news_item_id) continue;
    const source = sourceByNewsItemId.get(event.news_item_id);
    if (!source) continue;
    const weight = event.event_type === "save" ? 3 : event.event_type === "read" ? 2 : 1;
    readerValueBySource.set(source, (readerValueBySource.get(source) || 0) + weight);
  }

  const byUrl = new Map<string, Observation[]>();
  for (const observation of observations || []) {
    byUrl.set(observation.source_url, [...(byUrl.get(observation.source_url) || []), observation]);
  }

  return new Map(
    [...byUrl].map(([sourceUrl, rows]) => [
      sourceUrl,
      sourceQualityFromObservations(
        rows,
        readerValueBySource.get(rows[0]?.source_name.trim().toLocaleLowerCase("und") || "") || 0,
      ),
    ]),
  );
}
