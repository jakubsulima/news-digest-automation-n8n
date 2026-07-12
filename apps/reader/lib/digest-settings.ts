import "server-only";

import type { Json, Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

export type DigestFeedTargets = {
  geopolitics: number;
  business: number;
  ai: number;
  software: number;
  security: number;
};

export type ReaderDigestSettings = {
  excludedKeywords: string[];
  feedTargets: DigestFeedTargets;
  freshnessWindowHours: number;
  maxStoriesPerSource: number;
  minimumImportanceScore: number;
  minimumSourceCount: number;
  preferredKeywords: string[];
  publishTopN: number;
  requireMajorSecurity: boolean;
  summaryMaxChars: number;
  useAiSummaries: boolean;
};

type DigestRunRow = Database["public"]["Tables"]["digest_runs"]["Row"];
type SettingsRow = Database["public"]["Tables"]["reader_digest_settings"]["Row"];
type SettingsUpdate = Database["public"]["Tables"]["reader_digest_settings"]["Update"];
type SupabaseError = {
  code?: string;
  message?: string;
};

export const DEFAULT_DIGEST_SETTINGS: ReaderDigestSettings = {
  excludedKeywords: [
    "sports",
    "celebrity",
    "entertainment",
    "football",
    "soccer",
    "local crime",
    "lifestyle",
    "travel",
    "royal",
    "movie",
    "music",
  ],
  feedTargets: {
    geopolitics: 5,
    business: 4,
    ai: 8,
    software: 6,
    security: 5,
  },
  freshnessWindowHours: 72,
  maxStoriesPerSource: 4,
  minimumImportanceScore: 55,
  minimumSourceCount: 1,
  preferredKeywords: [
    "ai",
    "llm",
    "agent",
    "agents",
    "openai",
    "anthropic",
    "deepmind",
    "nvidia",
    "semiconductor",
    "gpu",
    "developer",
    "api",
    "github",
    "cloudflare",
    "vercel",
    "security",
    "zero-day",
    "ransomware",
    "breach",
    "exploit",
    "markets",
    "fed",
    "ecb",
    "rates",
    "sanctions",
    "export controls",
  ],
  publishTopN: 20,
  requireMajorSecurity: true,
  summaryMaxChars: 500,
  useAiSummaries: true,
};

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonStringArray(value: Json): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : "")).filter(Boolean))]
    : [];
}

function jsonBoolean(value: Json, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function jsonNumber(value: Json | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseFeedTargets(value: Json): DigestFeedTargets {
  const input = jsonRecord(value);

  return {
    geopolitics: clampInteger(jsonNumber(input.geopolitics, DEFAULT_DIGEST_SETTINGS.feedTargets.geopolitics), 0, 50),
    business: clampInteger(jsonNumber(input.business, DEFAULT_DIGEST_SETTINGS.feedTargets.business), 0, 50),
    ai: clampInteger(jsonNumber(input.ai, DEFAULT_DIGEST_SETTINGS.feedTargets.ai), 0, 50),
    software: clampInteger(jsonNumber(input.software, DEFAULT_DIGEST_SETTINGS.feedTargets.software), 0, 50),
    security: clampInteger(jsonNumber(input.security, DEFAULT_DIGEST_SETTINGS.feedTargets.security), 0, 50),
  };
}

function normalizeSettings(row: SettingsRow | null): ReaderDigestSettings {
  if (!row) {
    return DEFAULT_DIGEST_SETTINGS;
  }

  return {
    excludedKeywords: jsonStringArray(row.excluded_keywords),
    feedTargets: parseFeedTargets(row.feed_targets),
    freshnessWindowHours: clampInteger(row.freshness_window_hours ?? DEFAULT_DIGEST_SETTINGS.freshnessWindowHours, 6, 336),
    maxStoriesPerSource: clampInteger(row.max_stories_per_source ?? DEFAULT_DIGEST_SETTINGS.maxStoriesPerSource, 1, 20),
    minimumImportanceScore: clampInteger(row.minimum_importance_score, 0, 100),
    minimumSourceCount: clampInteger(row.minimum_source_count ?? DEFAULT_DIGEST_SETTINGS.minimumSourceCount, 1, 10),
    preferredKeywords: jsonStringArray(row.preferred_keywords),
    publishTopN: clampInteger(row.publish_top_n, 5, 100),
    requireMajorSecurity: row.require_major_security,
    summaryMaxChars: clampInteger(row.summary_max_chars, 180, 5000),
    useAiSummaries: row.use_ai_summaries,
  };
}

export function isDigestSettingsSchemaError(error: unknown) {
  const supabaseError = error && typeof error === "object" ? (error as SupabaseError) : {};

  return (
    supabaseError.code === "42P01" ||
    supabaseError.code === "42703" ||
    supabaseError.code === "PGRST204" ||
    supabaseError.code === "PGRST205" ||
    Boolean(supabaseError.message?.toLowerCase().includes("reader_digest_settings")) ||
    Boolean(supabaseError.message?.toLowerCase().includes("schema cache"))
  );
}

export async function getReaderDigestSettings(userId: string): Promise<ReaderDigestSettings> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reader_digest_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isDigestSettingsSchemaError(error)) {
      return DEFAULT_DIGEST_SETTINGS;
    }

    throw error;
  }

  return normalizeSettings(data);
}

export async function getDigestSettingsForRun(digestRunId: string): Promise<ReaderDigestSettings> {
  const supabase = createSupabaseAdminClient();
  const { data: run, error } = await supabase
    .from("digest_runs")
    .select("started_by_user_id")
    .eq("id", digestRunId)
    .maybeSingle<Pick<DigestRunRow, "started_by_user_id">>();

  if (error) {
    throw error;
  }

  return run?.started_by_user_id ? getReaderDigestSettings(run.started_by_user_id) : DEFAULT_DIGEST_SETTINGS;
}

export async function upsertReaderDigestSettings(userId: string, settings: ReaderDigestSettings) {
  const supabase = createSupabaseAdminClient();
  const update: SettingsUpdate & { user_id: string } = {
    excluded_keywords: settings.excludedKeywords,
    feed_targets: settings.feedTargets,
    freshness_window_hours: settings.freshnessWindowHours,
    max_stories_per_source: settings.maxStoriesPerSource,
    minimum_importance_score: settings.minimumImportanceScore,
    minimum_source_count: settings.minimumSourceCount,
    preferred_keywords: settings.preferredKeywords,
    publish_top_n: settings.publishTopN,
    require_major_security: settings.requireMajorSecurity,
    summary_max_chars: settings.summaryMaxChars,
    use_ai_summaries: settings.useAiSummaries,
    user_id: userId,
  };
  const { error } = await supabase.from("reader_digest_settings").upsert(update, {
    onConflict: "user_id",
  });

  if (error) {
    throw error;
  }
}

export function digestSettingsFromFormData(formData: FormData): ReaderDigestSettings {
  const numberValue = (name: string, fallback: number, min: number, max: number) => {
    const value = Number.parseInt(String(formData.get(name) || ""), 10);
    return clampInteger(Number.isFinite(value) ? value : fallback, min, max);
  };
  const keywords = (name: string) =>
    [...new Set(
      String(formData.get(name) || "")
        .split(",")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean),
    )].slice(0, 50);

  return {
    excludedKeywords: keywords("excludedKeywords"),
    feedTargets: {
      geopolitics: numberValue("feedTargetGeopolitics", DEFAULT_DIGEST_SETTINGS.feedTargets.geopolitics, 0, 50),
      business: numberValue("feedTargetBusiness", DEFAULT_DIGEST_SETTINGS.feedTargets.business, 0, 50),
      ai: numberValue("feedTargetAi", DEFAULT_DIGEST_SETTINGS.feedTargets.ai, 0, 50),
      software: numberValue("feedTargetSoftware", DEFAULT_DIGEST_SETTINGS.feedTargets.software, 0, 50),
      security: numberValue("feedTargetSecurity", DEFAULT_DIGEST_SETTINGS.feedTargets.security, 0, 50),
    },
    freshnessWindowHours: numberValue(
      "freshnessWindowHours",
      DEFAULT_DIGEST_SETTINGS.freshnessWindowHours,
      6,
      336,
    ),
    maxStoriesPerSource: numberValue(
      "maxStoriesPerSource",
      DEFAULT_DIGEST_SETTINGS.maxStoriesPerSource,
      1,
      20,
    ),
    minimumImportanceScore: numberValue(
      "minimumImportanceScore",
      DEFAULT_DIGEST_SETTINGS.minimumImportanceScore,
      0,
      100,
    ),
    minimumSourceCount: numberValue(
      "minimumSourceCount",
      DEFAULT_DIGEST_SETTINGS.minimumSourceCount,
      1,
      10,
    ),
    preferredKeywords: keywords("preferredKeywords"),
    publishTopN: numberValue("publishTopN", DEFAULT_DIGEST_SETTINGS.publishTopN, 5, 100),
    requireMajorSecurity: formData.get("requireMajorSecurity") === "on",
    summaryMaxChars: numberValue("summaryMaxChars", DEFAULT_DIGEST_SETTINGS.summaryMaxChars, 180, 5000),
    useAiSummaries: formData.get("useAiSummaries") === "on",
  };
}
