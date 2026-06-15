import "server-only";

import { z } from "zod";

import rssSources from "../../../config/rss-sources.json";
import type { Database, Json } from "./database.types";
import { getDigestRunById, sortDigestStages } from "./digest-runs";
import { createSupabaseAdminClient } from "./supabase";

type DigestRun = Database["public"]["Tables"]["digest_runs"]["Row"];
type PipelineStageRun = Database["public"]["Tables"]["pipeline_stage_runs"]["Row"];
type SourceItemInsert = Database["public"]["Tables"]["source_items"]["Insert"];

const sourceConfigSchema = z.array(
  z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    url: z.string().url(),
    priority: z.number().int().optional(),
  }),
);

type SourceConfig = z.infer<typeof sourceConfigSchema>[number];

type StageResult = {
  metrics?: Json;
};

const USER_AGENT = "daily-news-digest/4.0 (+vercel-next)";
const FEED_FETCH_TIMEOUT_MS = 15_000;
const MAX_RAW_ITEM_XML_LENGTH = 20_000;
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "at_campaign",
  "at_medium",
]);

export type AdvanceDigestRunResult = {
  runId: string;
  status: DigestRun["status"];
  advancedStage: PipelineStageRun["stage_name"] | null;
  message: string;
};

function readSourceConfig() {
  return sourceConfigSchema.parse(rssSources);
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, codepoint: string) => String.fromCodePoint(Number(codepoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)));
}

function stripHtml(value: string) {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagText(xml: string, tagName: string) {
  const escaped = escapeRegExp(tagName);
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));

  return match ? stripHtml(match[1]) : "";
}

function tagAttribute(xml: string, tagName: string, attributeName: string) {
  const escapedTag = escapeRegExp(tagName);
  const escapedAttribute = escapeRegExp(attributeName);
  const tagMatch = xml.match(new RegExp(`<${escapedTag}\\s+([^>]*)\\/?>`, "i"));

  if (!tagMatch) {
    return "";
  }

  const attrMatch = tagMatch[1].match(new RegExp(`${escapedAttribute}=["']([^"']+)["']`, "i"));

  return attrMatch ? decodeXmlEntities(attrMatch[1]).trim() : "";
}

function itemXmlBlocks(feedXml: string) {
  const blocks = [...feedXml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].map((match) => match[0]);

  if (blocks.length) {
    return blocks;
  }

  return [...feedXml.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

function normalizeUrl(value: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch {
    return null;
  }
}

function parsePublishedAt(value: string) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseSourceItems(feedXml: string, source: SourceConfig, digestRunId: string): SourceItemInsert[] {
  const items: SourceItemInsert[] = [];

  for (const itemXml of itemXmlBlocks(feedXml)) {
    const title = tagText(itemXml, "title");
    const link = tagText(itemXml, "link") || tagAttribute(itemXml, "link", "href");
    const summary =
      tagText(itemXml, "description") ||
      tagText(itemXml, "summary") ||
      tagText(itemXml, "content") ||
      tagText(itemXml, "content:encoded");
    const publishedAt =
      parsePublishedAt(tagText(itemXml, "pubDate")) ||
      parsePublishedAt(tagText(itemXml, "published")) ||
      parsePublishedAt(tagText(itemXml, "updated")) ||
      parsePublishedAt(tagText(itemXml, "dc:date"));

    if (!title && !link) {
      continue;
    }

    items.push({
      category: source.category,
      digest_run_id: digestRunId,
      normalized_url: normalizeUrl(link),
      published_at: publishedAt,
      raw_payload: {
        guid: tagText(itemXml, "guid") || tagText(itemXml, "id") || null,
        link: link || null,
        publishedAt,
        rawXml: itemXml.slice(0, MAX_RAW_ITEM_XML_LENGTH),
        sourcePriority: source.priority ?? null,
        summary,
        title,
      },
      source_name: source.name,
      source_url: source.url,
    });
  }

  return items;
}

async function fetchSource(source: SourceConfig, digestRunId: string) {
  const response = await fetch(source.url, {
    headers: {
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${source.name}: HTTP ${response.status}`);
  }

  const feedXml = await response.text();
  const items = parseSourceItems(feedXml, source, digestRunId);

  return {
    items,
    sourceName: source.name,
  };
}

async function runSourceFetchStage(digestRunId: string): Promise<StageResult> {
  const sources = await readSourceConfig();
  const settled = await Promise.allSettled(sources.map((source) => fetchSource(source, digestRunId)));
  const sourceItems: SourceItemInsert[] = [];
  const sourceCounts: Record<string, number> = {};
  const errors: string[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      sourceItems.push(...result.value.items);
      sourceCounts[result.value.sourceName] = result.value.items.length;
      continue;
    }

    errors.push(result.reason instanceof Error ? result.reason.message : "Unknown source fetch error");
  }

  const supabase = createSupabaseAdminClient();
  const { error: deleteError } = await supabase.from("source_items").delete().eq("digest_run_id", digestRunId);

  if (deleteError) {
    throw deleteError;
  }

  if (sourceItems.length) {
    const { error: insertError } = await supabase.from("source_items").insert(sourceItems);

    if (insertError) {
      throw insertError;
    }
  }

  return {
    metrics: {
      errors,
      fetchedItemCount: sourceItems.length,
      sourceCounts,
      sourcesConfigured: sources.length,
      sourcesFailed: errors.length,
      sourcesSucceeded: settled.filter((result) => result.status === "fulfilled").length,
    },
  };
}

async function runStageForRun(stageName: PipelineStageRun["stage_name"], digestRunId: string): Promise<StageResult> {
  if (stageName === "source_fetch") {
    return runSourceFetchStage(digestRunId);
  }

  throw new Error(`${stageName} stage is not ported to the hosted pipeline yet.`);
}

function nextQueuedStage(stages: PipelineStageRun[]) {
  return sortDigestStages(stages).find((stage) => stage.status === "queued") ?? null;
}

export async function advanceDigestRun(digestRunId: string): Promise<AdvanceDigestRunResult> {
  const run = await getDigestRunById(digestRunId);

  if (!run) {
    throw new Error("Digest run not found.");
  }

  if (run.status !== "queued" && run.status !== "running") {
    return {
      runId: run.id,
      status: run.status,
      advancedStage: null,
      message: `Run is already ${run.status}.`,
    };
  }

  const stage = nextQueuedStage(run.stages);
  const supabase = createSupabaseAdminClient();

  if (!stage) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("digest_runs")
      .update({
        finished_at: now,
        status: "succeeded",
      })
      .eq("id", run.id);

    if (error) {
      throw error;
    }

    return {
      runId: run.id,
      status: "succeeded",
      advancedStage: null,
      message: "Run finalized.",
    };
  }

  const now = new Date().toISOString();
  const { error: runError } = await supabase
    .from("digest_runs")
    .update({
      started_at: run.started_at ?? now,
      status: "running",
    })
    .eq("id", run.id);

  if (runError) {
    throw runError;
  }

  const { data: claimedStage, error: claimError } = await supabase
    .from("pipeline_stage_runs")
    .update({
      attempt_count: stage.attempt_count + 1,
      error_message: null,
      started_at: now,
      status: "running",
    })
    .eq("id", stage.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (claimError) {
    throw claimError;
  }

  if (!claimedStage) {
    return {
      runId: run.id,
      status: "running",
      advancedStage: null,
      message: "No queued stage was claimed.",
    };
  }

  try {
    const result = await runStageForRun(claimedStage.stage_name, run.id);
    const finishedAt = new Date().toISOString();
    const { error: stageError } = await supabase
      .from("pipeline_stage_runs")
      .update({
        finished_at: finishedAt,
        metrics: result.metrics ?? {},
        status: "succeeded",
      })
      .eq("id", claimedStage.id);

    if (stageError) {
      throw stageError;
    }

    return {
      runId: run.id,
      status: "running",
      advancedStage: claimedStage.stage_name,
      message: `${claimedStage.stage_name} succeeded.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stage failed.";
    const finishedAt = new Date().toISOString();
    const [{ error: stageError }, { error: digestRunError }] = await Promise.all([
      supabase
        .from("pipeline_stage_runs")
        .update({
          error_message: message,
          finished_at: finishedAt,
          status: "failed",
        })
        .eq("id", claimedStage.id),
      supabase
        .from("digest_runs")
        .update({
          error_message: message,
          finished_at: finishedAt,
          status: "failed",
        })
        .eq("id", run.id),
    ]);

    if (stageError) {
      throw stageError;
    }
    if (digestRunError) {
      throw digestRunError;
    }

    return {
      runId: run.id,
      status: "failed",
      advancedStage: claimedStage.stage_name,
      message,
    };
  }
}
