import "server-only";

import { z } from "zod";

import rssSources from "../../../config/rss-sources.json";
import type { Database } from "./database.types";
import { createSupabaseAdminClient } from "./supabase";

export type ReaderSource = {
  id: string;
  name: string;
  category: string;
  url: string;
  priority: number;
  enabled: boolean;
};

export type ReaderSourceInput = {
  id?: string;
  name: string;
  category: string;
  url: string;
  priority: number;
  enabled: boolean;
};

type ReaderSourceRow = Database["public"]["Tables"]["reader_sources"]["Row"];
type ReaderSourceInsert = Database["public"]["Tables"]["reader_sources"]["Insert"];
type ReaderSourceUpdate = Database["public"]["Tables"]["reader_sources"]["Update"];
type SupabaseError = {
  code?: string;
  message?: string;
};

const sourceConfigSchema = z.array(
  z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    url: z.string().url(),
    priority: z.number().int().min(1).max(5).optional(),
  }),
);

const sourceInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000),
  priority: z.coerce.number().int().min(1).max(5),
  enabled: z.boolean(),
});

function rowToSource(row: ReaderSourceRow): ReaderSource {
  return {
    category: row.category,
    enabled: row.enabled,
    id: row.id,
    name: row.name,
    priority: row.priority,
    url: row.feed_url,
  };
}

function fallbackSources(): ReaderSource[] {
  return sourceConfigSchema.parse(rssSources).map((source, index) => ({
    category: source.category,
    enabled: true,
    id: `fallback-${index}`,
    name: source.name,
    priority: source.priority ?? 3,
    url: source.url,
  }));
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
      return fallbackSources();
    }

    throw error;
  }

  return data?.length ? data.map(rowToSource) : fallbackSources();
}

export function readerSourceFromFormData(formData: FormData): ReaderSourceInput {
  const id = String(formData.get("id") || "").trim();

  return sourceInputSchema.parse({
    category: formData.get("category"),
    enabled: formData.get("enabled") === "on",
    id: id || undefined,
    name: formData.get("name"),
    priority: formData.get("priority"),
    url: formData.get("url"),
  });
}

export async function upsertReaderSource(source: ReaderSourceInput) {
  const supabase = createSupabaseAdminClient();

  if (source.id) {
    const update: ReaderSourceUpdate = {
      category: source.category,
      enabled: source.enabled,
      feed_url: source.url,
      name: source.name,
      priority: source.priority,
    };
    const { error } = await supabase.from("reader_sources").update(update).eq("id", source.id);

    if (error) {
      throw error;
    }

    return;
  }

  const insert: ReaderSourceInsert = {
    category: source.category,
    enabled: source.enabled,
    feed_url: source.url,
    name: source.name,
    priority: source.priority,
  };
  const { error } = await supabase.from("reader_sources").insert(insert);

  if (error) {
    throw error;
  }
}
