import "server-only";

import { z } from "zod";

import type { Database } from "../database.types";
import { createSupabaseAdminClient } from "../supabase";
import { discoverSource } from "./discovery";

const confirmationSchema = z.object({
  category: z.string().trim().min(1).max(200),
  feedUrl: z.string().url().max(2_000),
  name: z.string().trim().min(1).max(200),
  rawUrl: z.string().url().max(2_000),
});

function normalizeExistingUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch {
    return value;
  }
}

async function existingFeedUrls() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("reader_sources").select("feed_url, normalized_feed_url");
  if (error) throw error;
  return new Set((data || []).flatMap((source) => [
    normalizeExistingUrl(source.feed_url),
    normalizeExistingUrl(source.normalized_feed_url),
  ]));
}

export async function discoverReaderSourceFromRepository(rawUrl: string) {
  return discoverSource(rawUrl, await existingFeedUrls());
}

export async function confirmReaderSourceFromRepository(rawInput: {
  category: string;
  feedUrl: string;
  name: string;
  rawUrl: string;
}) {
  const input = confirmationSchema.parse(rawInput);
  const proposal = await discoverReaderSourceFromRepository(input.rawUrl);
  if (proposal.feedUrl !== normalizeExistingUrl(input.feedUrl)) {
    throw new Error("The discovered feed changed before confirmation. Review the new proposal.");
  }
  if (proposal.alreadyExists) throw new Error("This feed already exists in the source catalog.");
  const row: Database["public"]["Tables"]["reader_sources"]["Insert"] = {
    canonical_host: proposal.canonicalHost,
    category: input.category,
    enabled: false,
    feed_type: proposal.feedType,
    feed_url: proposal.feedUrl,
    language: proposal.language,
    last_validated_at: new Date().toISOString(),
    name: input.name,
    normalized_feed_url: proposal.feedUrl,
    priority: 3,
    selection_mode: "auto",
    validation_diagnostics: proposal.diagnostics,
    validation_status: "valid",
  };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("reader_sources").insert(row).select("id").single();
  if (error) throw error;
  return { proposal, sourceId: data.id };
}
