import "server-only";

import type { Database, Json } from "./database.types";
import type { FeedEventInput } from "./feed-events";
import type { FeedbackBasis, FeedbackReason, FeedbackSentiment } from "./reader-feedback-scoring";
import { createSupabaseAdminClient } from "./supabase";

type PreferenceDimension = "topic" | "entity" | "source" | "repetition" | "quality";

type SignalItem = Pick<
  Database["public"]["Tables"]["news_items"]["Row"],
  "category" | "entity_tags" | "id" | "source" | "source_variants" | "story_cluster_id" | "topic_tags"
>;

type SupabaseError = { code?: string; message?: string };

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringList(value: Json) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function isPreferenceSignalSchemaError(error: unknown) {
  const value = error && typeof error === "object" ? error as SupabaseError : {};
  return value.code === "42P01" || value.code === "42703" || value.code === "PGRST204" ||
    value.code === "PGRST205" || Boolean(value.message?.toLowerCase().includes("reader_preference_signals"));
}

export function explicitPreferenceSignalForItem(
  item: SignalItem,
  reason: FeedbackReason,
  sentiment: FeedbackSentiment,
) {
  if (!item.story_cluster_id) return null;
  const canonicalVariant = Array.isArray(item.source_variants)
    ? item.source_variants.map(jsonRecord).find((variant) => typeof variant.readerSourceId === "string")
    : undefined;
  const readerSourceId = typeof canonicalVariant?.readerSourceId === "string"
    ? canonicalVariant.readerSourceId
    : null;
  const dimension: PreferenceDimension = reason === "repetitive" ? "repetition" : reason;
  const target = dimension === "topic"
    ? stringList(item.topic_tags)[0] || item.category
    : dimension === "entity"
      ? stringList(item.entity_tags)[0]
      : dimension === "source"
        ? item.source
        : item.story_cluster_id;
  if (!target) return null;

  return {
    confidence: 1,
    dimension,
    metadata: { newsItemId: item.id },
    origin: "explicit" as const,
    reader_source_id: dimension === "source" ? readerSourceId : null,
    sentiment,
    story_cluster_id: item.story_cluster_id,
    target: target.trim(),
    weight: 1,
  };
}

export async function setExplicitPreferenceSignal(
  userId: string,
  newsItemId: string,
  sentiment: FeedbackSentiment | null,
  reason: FeedbackReason,
) {
  const supabase = createSupabaseAdminClient();
  const { data: item, error: itemError } = await supabase
    .from("news_items")
    .select("id, story_cluster_id, category, source, source_variants, topic_tags, entity_tags")
    .eq("id", newsItemId)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) return;
  const signal = explicitPreferenceSignalForItem(item, reason, sentiment || "less");
  if (!signal) return;

  if (!sentiment) {
    const { error } = await supabase
      .from("reader_preference_signals")
      .delete()
      .eq("user_id", userId)
      .eq("story_cluster_id", signal.story_cluster_id)
      .eq("dimension", signal.dimension)
      .eq("target", signal.target)
      .eq("origin", "explicit");
    if (error && !isPreferenceSignalSchemaError(error)) throw error;
    return;
  }

  const { error } = await supabase.from("reader_preference_signals").upsert(
    { ...signal, user_id: userId },
    { onConflict: "user_id,story_cluster_id,dimension,target,origin" },
  );
  if (error && !isPreferenceSignalSchemaError(error)) throw error;
}

function behavioralWeight(eventType: string) {
  switch (eventType) {
    case "save": return { confidence: 0.85, weight: 0.8 };
    case "read": return { confidence: 0.65, weight: 0.5 };
    case "source_open": return { confidence: 0.6, weight: 0.4 };
    case "fast_read": return { confidence: 0.4, weight: 0.25 };
    default: return null;
  }
}

export async function recordBehavioralPreferenceSignals(userId: string, events: FeedEventInput[]) {
  const eligible = events.flatMap((event) => {
    if (
      !event.storyClusterId ||
      (event.interactionOrigin !== undefined &&
        event.interactionOrigin !== null &&
        event.interactionOrigin !== "direct")
    ) {
      return [];
    }
    const strength = behavioralWeight(event.eventType);
    return strength ? [{ event, storyClusterId: event.storyClusterId, strength }] : [];
  });
  if (!eligible.length) return;
  const supabase = createSupabaseAdminClient();
  const clusterIds = [...new Set(eligible.map(({ storyClusterId }) => storyClusterId))];
  const { data: clusters, error: clusterError } = await supabase
    .from("story_clusters")
    .select("id, category, source, topic_tags")
    .in("id", clusterIds);
  if (clusterError) {
    if (isPreferenceSignalSchemaError(clusterError)) return;
    throw clusterError;
  }
  const clusterById = new Map((clusters || []).map((cluster) => [cluster.id, cluster]));
  const rows: Database["public"]["Tables"]["reader_preference_signals"]["Insert"][] = [];
  for (const { event, storyClusterId, strength } of eligible) {
    const cluster = clusterById.get(storyClusterId);
    if (!cluster) continue;
    const metadata = jsonRecord(event.metadata || {});
    const isSource = event.eventType === "source_open";
    const readerSourceId = isSource && typeof metadata.readerSourceId === "string" ? metadata.readerSourceId : null;
    rows.push({
      confidence: strength.confidence,
      dimension: isSource ? "source" : "topic",
      metadata: { eventType: event.eventType, sessionId: event.sessionId },
      origin: "behavioral",
      reader_source_id: readerSourceId,
      sentiment: "more",
      story_cluster_id: storyClusterId,
      target: isSource ? cluster.source : stringList(cluster.topic_tags)[0] || cluster.category,
      user_id: userId,
      weight: strength.weight,
    });
  }
  if (!rows.length) return;
  const { error } = await supabase.from("reader_preference_signals").upsert(rows, {
    onConflict: "user_id,story_cluster_id,dimension,target,origin",
  });
  if (error && !isPreferenceSignalSchemaError(error)) throw error;
}

export async function getPreferenceSignalBasis(userId: string): Promise<FeedbackBasis[] | null> {
  const supabase = createSupabaseAdminClient();
  const { data: signals, error } = await supabase
    .from("reader_preference_signals")
    .select("story_cluster_id, dimension, target, sentiment, origin, weight, confidence, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1_000);
  if (error) {
    if (isPreferenceSignalSchemaError(error)) return null;
    throw error;
  }
  if (!signals?.length) return null;
  const explicit = signals.filter((signal) => signal.origin === "explicit");
  const behavioral = signals.filter((signal) => signal.origin === "behavioral");
  const behavioralStoryCount = new Set(behavioral.map((signal) => signal.story_cluster_id)).size;
  const usable = [...explicit, ...(behavioralStoryCount >= 5 ? behavioral : [])];
  if (!usable.length) return null;
  const clusterIds = [...new Set(usable.map((signal) => signal.story_cluster_id))];
  const { data: clusters, error: clusterError } = await supabase
    .from("story_clusters")
    .select("id, category, source, canonical_title, latest_summary, topic_tags, entity_tags")
    .in("id", clusterIds);
  if (clusterError) throw clusterError;
  const clusterById = new Map((clusters || []).map((cluster) => [cluster.id, cluster]));

  return usable.flatMap((signal) => {
    const cluster = clusterById.get(signal.story_cluster_id);
    if (!cluster) return [];
    return [{
      category: signal.dimension === "topic" ? signal.target : cluster.category,
      entityTags: signal.dimension === "entity" ? [signal.target] : stringList(cluster.entity_tags),
      origin: signal.origin === "behavioral" ? "implicit" as const : "explicit" as const,
      reason: signal.dimension === "repetition" ? "repetitive" : signal.dimension,
      sentiment: signal.sentiment,
      source: signal.dimension === "source" ? signal.target : cluster.source,
      storyClusterId: cluster.id,
      summary: signal.dimension === "entity" ? signal.target : cluster.latest_summary,
      title: signal.dimension === "topic" ? signal.target : cluster.canonical_title,
      topicTags: signal.dimension === "topic" ? [signal.target] : stringList(cluster.topic_tags),
      updatedAt: signal.updated_at,
      weight: signal.weight * signal.confidence,
    }];
  });
}

export async function deletePreferenceSignals(userId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("reader_preference_signals").delete().eq("user_id", userId);
  if (error && !isPreferenceSignalSchemaError(error)) throw error;
}
