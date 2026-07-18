import "server-only";

import { z } from "zod";

import rssSources from "../../../config/rss-sources.json";
import type { Database } from "./database.types";
import { readerFeedForCategory } from "./feed-categories";
import { createSupabaseAdminClient } from "./supabase";

export type ReaderSource = {
  id: string;
  name: string;
  category: string;
  url: string;
  priority: number;
  selectionMode: "auto" | "always_on" | "blocked";
  enabled: boolean;
  feedType: "rss" | "atom" | "unknown";
  language: string;
  validationStatus: "unverified" | "valid" | "invalid" | "blocked";
  lastValidatedAt: string | null;
};

export type ReaderSourceInput = {
  id?: string;
  name: string;
  category: string;
  url: string;
  priority: number;
  selectionMode: "auto" | "always_on" | "blocked";
  enabled: boolean;
};

type ReaderSourceRow = Database["public"]["Tables"]["reader_sources"]["Row"];
type ReaderSourceInsert = Database["public"]["Tables"]["reader_sources"]["Insert"];
type ReaderSourceUpdate = Database["public"]["Tables"]["reader_sources"]["Update"];
type SourceConfig = z.infer<typeof sourceConfigSchema>[number];
type SupabaseError = {
  code?: string;
  message?: string;
};

const sourceConfigSchema = z.array(
  z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    url: z.string().url(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(1).max(5).optional(),
  }),
);

const sourceInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000),
  priority: z.coerce.number().int().min(1).max(5),
  selectionMode: z.enum(["auto", "always_on", "blocked"]),
  enabled: z.boolean(),
});
const sourceCountSchema = z.coerce.number().int().min(0).max(500);

export const SOURCE_PRESETS = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Default broad mix across news, markets, AI, software, and security.",
  },
  {
    id: "essentials",
    label: "Essentials",
    description: "Smaller daily set with only the highest-signal sources from each group.",
  },
  {
    id: "markets",
    label: "Markets + geopolitics",
    description: "World events, business, central banks, regulators, and energy.",
  },
  {
    id: "ai-software",
    label: "AI + software",
    description: "Labs, AI market coverage, developer tooling, cloud, and engineering.",
  },
  {
    id: "security-watch",
    label: "Security watch",
    description: "Threat intelligence, advisories, incident response, and service status feeds.",
  },
] as const;

export type SourcePresetId = (typeof SOURCE_PRESETS)[number]["id"];

const SOURCE_PRESET_IDS = new Set<SourcePresetId>(SOURCE_PRESETS.map((preset) => preset.id));
const ESSENTIAL_SOURCE_NAMES = new Set([
  "300Gospodarka",
  "Al Jazeera",
  "Ars Technica",
  "BBC Business",
  "BBC World",
  "BleepingComputer",
  "CERT Polska",
  "CISA Cybersecurity Advisories",
  "Cloudflare Blog",
  "Deutsche Welle World",
  "ECB Press",
  "Federal Reserve Press Releases",
  "GitHub Blog",
  "Google AI Blog",
  "Google DeepMind Blog",
  "Hacker News Frontpage",
  "Hugging Face Blog",
  "KrebsOnSecurity",
  "Niebezpiecznik",
  "NVIDIA Blog - AI",
  "OpenAI News",
  "POLITICO Europe",
  "Rest of World Money",
  "The Guardian World",
]);

const SECURITY_CORE_SOURCE_NAMES = new Set([
  "BleepingComputer",
  "CERT Polska",
  "CISA Cybersecurity Advisories",
  "CISA Current Activity",
  "KrebsOnSecurity",
  "Niebezpiecznik",
  "The Hacker News",
]);

function configuredSources(): SourceConfig[] {
  return sourceConfigSchema.parse(rssSources);
}

function rowToSource(row: ReaderSourceRow): ReaderSource {
  const feedType = row.feed_type === "rss" || row.feed_type === "atom" ? row.feed_type : "unknown";
  const validationStatus = ["valid", "invalid", "blocked"].includes(row.validation_status)
    ? row.validation_status
    : "unverified";
  return {
    category: row.category,
    enabled: row.enabled,
    feedType,
    id: row.id,
    language: row.language || "unknown",
    lastValidatedAt: row.last_validated_at || null,
    name: row.name,
    priority: row.priority,
    selectionMode: row.selection_mode,
    url: row.feed_url,
    validationStatus,
  };
}

function fallbackSources(): ReaderSource[] {
  return configuredSources().map((source, index) => ({
    category: source.category,
    enabled: source.enabled ?? true,
    feedType: "unknown",
    id: `fallback-${index}`,
    language: "unknown",
    lastValidatedAt: null,
    name: source.name,
    priority: source.priority ?? 3,
    selectionMode: source.enabled === false ? "blocked" : "always_on",
    url: source.url,
    validationStatus: "unverified",
  }));
}

function enabledFallbackSources(): ReaderSource[] {
  return fallbackSources().filter((source) => source.enabled);
}

export function sourcePresetFromFormData(formData: FormData): SourcePresetId {
  const presetId = String(formData.get("sourcePreset") || "");

  if (!SOURCE_PRESET_IDS.has(presetId as SourcePresetId)) {
    throw new Error("Invalid source preset.");
  }

  return presetId as SourcePresetId;
}

function isSourceEnabledForPreset(source: SourceConfig, presetId: SourcePresetId) {
  const feed = readerFeedForCategory(source.category);

  switch (presetId) {
    case "balanced":
      return source.enabled ?? true;
    case "essentials":
      return ESSENTIAL_SOURCE_NAMES.has(source.name);
    case "markets":
      return feed === "geopolitics" || feed === "business" || SECURITY_CORE_SOURCE_NAMES.has(source.name);
    case "ai-software":
      return feed === "ai" || feed === "software" || SECURITY_CORE_SOURCE_NAMES.has(source.name);
    case "security-watch":
      return feed === "security" || source.category.toLowerCase().includes("status");
  }
}

export function isReaderSourcesSchemaError(error: unknown) {
  const supabaseError = error && typeof error === "object" ? (error as SupabaseError) : {};

  return (
    supabaseError.code === "42P01" ||
    supabaseError.code === "42703" ||
    supabaseError.code === "PGRST204" ||
    supabaseError.code === "PGRST205" ||
    Boolean(supabaseError.message?.toLowerCase().includes("reader_sources")) ||
    Boolean(supabaseError.message?.toLowerCase().includes("schema cache"))
  );
}

export function isReaderSourceValidationError(error: unknown) {
  return error instanceof z.ZodError;
}

export async function getReaderSources(): Promise<ReaderSource[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reader_sources")
    .select("*")
    .order("enabled", { ascending: false })
    .order("priority", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    if (isReaderSourcesSchemaError(error)) {
      return fallbackSources();
    }

    throw error;
  }

  return data?.length ? data.map(rowToSource) : fallbackSources();
}

export async function getReaderSourcesForRun(): Promise<ReaderSource[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reader_sources")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    if (isReaderSourcesSchemaError(error)) {
      return enabledFallbackSources();
    }

    throw error;
  }

  return data?.length ? data.map(rowToSource) : enabledFallbackSources();
}

export function readerSourceFromFormData(formData: FormData): ReaderSourceInput {
  const id = String(formData.get("id") || "").trim();
  const enabled = formData.get("enabled") === "on";

  return sourceInputSchema.parse({
    category: formData.get("category"),
    enabled,
    id: id || undefined,
    name: formData.get("name"),
    priority: formData.get("priority"),
    selectionMode: formData.get("selectionMode") || (enabled ? "always_on" : "blocked"),
    url: formData.get("url"),
  });
}

export function readerSourcesFromFormData(formData: FormData): ReaderSourceInput[] {
  const sourceCount = sourceCountSchema.parse(formData.get("sourceCount") ?? 0);

  return Array.from({ length: sourceCount }, (_, index) => {
    const fieldPrefix = `sources.${index}`;
    const id = String(formData.get(`${fieldPrefix}.id`) || "").trim();
    const enabled = formData.get(`${fieldPrefix}.enabled`) === "on";

    return sourceInputSchema.parse({
      category: formData.get(`${fieldPrefix}.category`),
      enabled,
      id: id || undefined,
      name: formData.get(`${fieldPrefix}.name`),
      priority: formData.get(`${fieldPrefix}.priority`),
      selectionMode: formData.get(`${fieldPrefix}.selectionMode`) || (enabled ? "always_on" : "blocked"),
      url: formData.get(`${fieldPrefix}.url`),
    });
  });
}

export async function upsertReaderSource(source: ReaderSourceInput) {
  const supabase = createSupabaseAdminClient();
  const enabled = source.selectionMode === "always_on"
    ? true
    : source.selectionMode === "blocked"
      ? false
      : source.enabled;
  const sourceUrl = new URL(source.url);
  sourceUrl.hash = "";
  const normalizedFeedUrl = sourceUrl.toString();

  if (source.id) {
    const update: ReaderSourceUpdate = {
      category: source.category,
      enabled,
      feed_url: source.url,
      canonical_host: sourceUrl.hostname.toLowerCase(),
      normalized_feed_url: normalizedFeedUrl,
      name: source.name,
      priority: source.priority,
      selection_mode: source.selectionMode,
    };
    const { error } = await supabase.from("reader_sources").update(update).eq("id", source.id);

    if (error) {
      throw error;
    }

    return;
  }

  const insert: ReaderSourceInsert = {
    category: source.category,
    enabled,
    feed_url: source.url,
    canonical_host: sourceUrl.hostname.toLowerCase(),
    feed_type: "unknown",
    language: "unknown",
    normalized_feed_url: normalizedFeedUrl,
    name: source.name,
    priority: source.priority,
    selection_mode: source.selectionMode,
    validation_status: "unverified",
  };
  const { error } = await supabase.from("reader_sources").insert(insert);

  if (error) {
    throw error;
  }
}

export async function setReaderSourceSelectionMode(
  sourceId: string,
  selectionMode: ReaderSource["selectionMode"],
) {
  const supabase = createSupabaseAdminClient();
  const enabled = selectionMode === "always_on" ? true : selectionMode === "blocked" ? false : undefined;
  const { error } = await supabase
    .from("reader_sources")
    .update({
      ...(enabled === undefined ? {} : { enabled }),
      selection_mode: selectionMode,
    })
    .eq("id", sourceId);
  if (error) throw error;
}

export async function upsertReaderSources(sources: ReaderSourceInput[]) {
  for (const source of sources) {
    await upsertReaderSource(source);
  }
}

export async function applyReaderSourcePreset(presetId: SourcePresetId) {
  const supabase = createSupabaseAdminClient();
  const rows: ReaderSourceInsert[] = configuredSources().map((source) => ({
    canonical_host: new URL(source.url).hostname.toLowerCase(),
    category: source.category,
    enabled: isSourceEnabledForPreset(source, presetId),
    feed_url: source.url,
    feed_type: "unknown",
    language: "unknown",
    name: source.name,
    normalized_feed_url: source.url,
    priority: source.priority ?? 3,
    selection_mode: isSourceEnabledForPreset(source, presetId) ? "always_on" : "blocked",
    validation_status: "unverified",
  }));

  const { error } = await supabase.from("reader_sources").upsert(rows, { onConflict: "feed_url" });

  if (error) {
    throw error;
  }
}
