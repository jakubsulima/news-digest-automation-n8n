import "server-only";

import type { Database } from "../database.types";
import { getDigestSettingsForRun } from "../digest-settings";
import { getReaderSources, type ReaderSource } from "../reader-sources";
import { getSourceQualityInsights, sourceQualityFromObservations } from "../source-quality";
import { createSupabaseAdminClient } from "../supabase";
import { buildSourcePortfolio } from "./policy";
import { evaluateSourceAutopilotGate, type SourcePortfolioRunSummary } from "./autopilot";
import type { SourcePortfolioDecision, SourcePortfolioMetrics } from "./types";

export { buildSourcePortfolio } from "./policy";
export { evaluateSourceAutopilotGate } from "./autopilot";
export type { SourcePortfolioDecision, SourcePortfolioInput, SourcePortfolioMetrics } from "./types";

export type PortfolioSource = ReaderSource & { portfolioRole: "selected" | "explore" | "probe" };

const MAX_AUTOMATIC_CHANGE_RATIO = 0.2;
const EXPLORATION_SOURCE_COUNT = 1;

function metricsForObservations(
  observations: Database["public"]["Tables"]["source_run_observations"]["Row"][],
  healthyProbeCount = 0,
  readerValue = 50,
): SourcePortfolioMetrics {
  if (!observations.length) {
    return {
      confirmationValue: 50,
      fetchPenalty: 0,
      freshYield: 50,
      healthyProbeCount,
      readerValue,
      redundancyPenalty: 0,
      reliability: 50,
      runCount: 0,
      selectionValue: 50,
      uniqueYield: 50,
    };
  }
  const quality = sourceQualityFromObservations(observations);
  const averageDuration = observations.reduce((sum, row) => sum + row.duration_ms, 0) / observations.length;
  return {
    confirmationValue: quality.confirmationValue,
    fetchPenalty: Math.min(15, Math.max(0, (100 - quality.reliability) * 0.1 + averageDuration / 10_000)),
    freshYield: quality.freshYield,
    healthyProbeCount,
    readerValue,
    redundancyPenalty: Math.max(0, (50 - quality.uniqueYield) * 0.2),
    reliability: quality.reliability,
    runCount: quality.runCount,
    selectionValue: quality.selectionValue,
    uniqueYield: quality.uniqueYield,
  };
}

function sourcesForFrozenDecisions(sources: ReaderSource[], decisions: SourcePortfolioDecision[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return decisions.flatMap((decision) => {
    const source = sourceById.get(decision.sourceId);
    return source && (decision.actualSelected || decision.role === "probe")
      ? [{ ...source, portfolioRole: decision.role as PortfolioSource["portfolioRole"] }]
      : [];
  });
}

async function loadLastSuccessfulDecisionRows() {
  const supabase = createSupabaseAdminClient();
  const { data: runs, error: runError } = await supabase
    .from("digest_runs")
    .select("id")
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(10);
  if (runError) throw runError;
  const runIds = (runs || []).map((run) => run.id);
  if (!runIds.length) return [];
  const { data: rows, error } = await supabase
    .from("digest_run_source_decisions")
    .select("*")
    .in("digest_run_id", runIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const latestRunId = runIds.find((runId) => rows?.some((row) => row.digest_run_id === runId));
  return latestRunId ? (rows || []).filter((row) => row.digest_run_id === latestRunId) : [];
}

function decisionFromRow(
  row: Database["public"]["Tables"]["digest_run_source_decisions"]["Row"],
): SourcePortfolioDecision {
  return {
    actualSelected: row.actual_selected,
    confidence: row.confidence,
    legacyEnabled: row.legacy_enabled,
    proposedSelected: row.proposed_selected,
    reasons: Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    role: row.role,
    score: row.score,
    scoreComponents: row.score_components && typeof row.score_components === "object" && !Array.isArray(row.score_components)
      ? Object.fromEntries(Object.entries(row.score_components).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
      : {},
    sourceId: row.reader_source_id,
  };
}

export async function getLastSuccessfulSourcePortfolio() {
  const [sources, rows] = await Promise.all([getReaderSources(), loadLastSuccessfulDecisionRows()]);
  if (!rows.length) return null;
  const decisions = rows.map(decisionFromRow);
  const fetchSources = sourcesForFrozenDecisions(sources, decisions);
  return fetchSources.length ? { decisions, sources: fetchSources } : null;
}

export async function getSourcePortfolioSuggestions() {
  const supabase = createSupabaseAdminClient();
  const { data: rows, error } = await supabase
    .from("digest_run_source_decisions")
    .select("*")
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const latestRunId = rows?.[0]?.digest_run_id;
  if (!latestRunId) return [];
  const sources = await getReaderSources();
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return (rows || []).flatMap((row) => {
    if (row.digest_run_id !== latestRunId || row.proposed_selected === row.legacy_enabled) return [];
    const source = sourceById.get(row.reader_source_id);
    if (!source) return [];
    const components = row.score_components && typeof row.score_components === "object" && !Array.isArray(row.score_components)
      ? row.score_components
      : {};
    return [{
      action: row.proposed_selected ? "add" as const : "remove" as const,
      confidence: row.confidence,
      decisionId: row.id,
      feed: source.category,
      reasons: Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [],
      runCount: typeof components.runCount === "number" ? components.runCount : 0,
      score: row.score,
      sourceId: source.id,
      sourceName: source.name,
    }];
  });
}

export async function getSourceAutopilotGate() {
  const supabase = createSupabaseAdminClient();
  const [{ data: decisions, error: decisionError }, { data: observations, error: observationError }] = await Promise.all([
    supabase
      .from("digest_run_source_decisions")
      .select("digest_run_id, portfolio_mode, created_at")
      .order("created_at", { ascending: false })
      .limit(5_000),
    supabase
      .from("source_run_observations")
      .select("digest_run_id, category, status, unique_story_count, selected_story_count")
      .order("created_at", { ascending: false })
      .limit(5_000),
  ]);
  if (decisionError) throw decisionError;
  if (observationError) throw observationError;
  const modeByRun = new Map<string, "manual" | "advisory" | "automatic">();
  for (const decision of decisions || []) {
    if (!modeByRun.has(decision.digest_run_id)) modeByRun.set(decision.digest_run_id, decision.portfolio_mode);
  }
  const observationsByRun = new Map<string, NonNullable<typeof observations>>();
  for (const observation of observations || []) {
    observationsByRun.set(observation.digest_run_id, [
      ...(observationsByRun.get(observation.digest_run_id) || []),
      observation,
    ]);
  }
  const summaries: SourcePortfolioRunSummary[] = [...modeByRun].flatMap(([runId]) => {
    const rows = observationsByRun.get(runId) || [];
    if (!rows.length) return [];
    const totalSelected = rows.reduce((sum, row) => sum + row.selected_story_count, 0);
    return [{
      categoryCoverage: new Set(
        rows.filter((row) => row.status === "succeeded" && row.unique_story_count > 0).map((row) => row.category),
      ).size,
      fetchFailureRate: rows.filter((row) => row.status === "failed").length / rows.length,
      runId,
      topPublisherConcentration: totalSelected
        ? Math.max(...rows.map((row) => row.selected_story_count)) / totalSelected
        : 0,
      uniqueSelectedStories: totalSelected,
    }];
  });

  return evaluateSourceAutopilotGate(
    summaries.filter((run) => modeByRun.get(run.runId) === "automatic"),
    summaries.filter((run) => modeByRun.get(run.runId) !== "automatic"),
  );
}

export async function applySourcePortfolioSuggestion(decisionId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: decision, error } = await supabase
    .from("digest_run_source_decisions")
    .select("reader_source_id, proposed_selected")
    .eq("id", decisionId)
    .maybeSingle();
  if (error) throw error;
  if (!decision) throw new Error("Source Portfolio suggestion not found.");
  const { error: updateError } = await supabase
    .from("reader_sources")
    .update({ enabled: decision.proposed_selected })
    .eq("id", decision.reader_source_id);
  if (updateError) throw updateError;
}

export async function dismissSourcePortfolioSuggestion(decisionId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("digest_run_source_decisions")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", decisionId);
  if (error) throw error;
}

export async function getOrCreateSourcePortfolio(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const [sources, settings, existingResult] = await Promise.all([
    getReaderSources(),
    getDigestSettingsForRun(digestRunId),
    supabase.from("digest_run_source_decisions").select("*").eq("digest_run_id", digestRunId),
  ]);
  if (existingResult.error) throw existingResult.error;
  if (existingResult.data?.length) {
    const decisions = existingResult.data.map(decisionFromRow);
    return { decisions, mode: settings.sourcePortfolioMode, sources: sourcesForFrozenDecisions(sources, decisions) };
  }

  const { data: digestRun, error: digestRunError } = await supabase
    .from("digest_runs")
    .select("started_by_user_id")
    .eq("id", digestRunId)
    .maybeSingle();
  if (digestRunError) throw digestRunError;
  const readerQuality = digestRun?.started_by_user_id
    ? await getSourceQualityInsights(digestRun.started_by_user_id)
    : new Map();

  const { data: observations, error: observationError } = await supabase
    .from("source_run_observations")
    .select("*")
    .not("reader_source_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(5_000);
  if (observationError) throw observationError;
  const { data: probeDecisions, error: probeError } = await supabase
    .from("digest_run_source_decisions")
    .select("digest_run_id, reader_source_id")
    .eq("role", "probe")
    .order("created_at", { ascending: false })
    .limit(1_000);
  if (probeError) throw probeError;
  const successfulObservationKeys = new Set(
    (observations || [])
      .filter((observation) => observation.status === "succeeded" && observation.reader_source_id)
      .map((observation) => `${observation.digest_run_id}:${observation.reader_source_id}`),
  );
  const healthyProbeCountBySource = new Map<string, number>();
  for (const decision of probeDecisions || []) {
    if (!successfulObservationKeys.has(`${decision.digest_run_id}:${decision.reader_source_id}`)) continue;
    healthyProbeCountBySource.set(
      decision.reader_source_id,
      (healthyProbeCountBySource.get(decision.reader_source_id) || 0) + 1,
    );
  }
  const observationsBySource = new Map<string, NonNullable<typeof observations>>();
  for (const observation of observations || []) {
    if (!observation.reader_source_id) continue;
    const rows = observationsBySource.get(observation.reader_source_id) || [];
    if (rows.length < 30) rows.push(observation);
    observationsBySource.set(observation.reader_source_id, rows);
  }

  const previousRows = settings.sourcePortfolioMode === "automatic" ? await loadLastSuccessfulDecisionRows() : [];
  const { decisions, policyVersion } = buildSourcePortfolio({
    categoryMinimums: settings.sourceCategoryMinimums,
    explorationCount: EXPLORATION_SOURCE_COUNT,
    maxChangeRatio: MAX_AUTOMATIC_CHANGE_RATIO,
    mode: settings.sourcePortfolioMode,
    previousSelectedIds: previousRows.length
      ? new Set(previousRows.filter((row) => row.actual_selected).map((row) => row.reader_source_id))
      : undefined,
    probeCount: settings.sourceProbeCount,
    sourceBudget: settings.sourceBudget,
    sources: sources.map((source) => ({
      ...source,
      metrics: metricsForObservations(
        observationsBySource.get(source.id) || [],
        healthyProbeCountBySource.get(source.id) || 0,
        readerQuality.get(source.id)?.readerValue ?? 50,
      ),
    })),
  });
  const rows: Database["public"]["Tables"]["digest_run_source_decisions"]["Insert"][] = decisions.map((decision) => ({
    actual_selected: decision.actualSelected,
    confidence: decision.confidence,
    digest_run_id: digestRunId,
    legacy_enabled: decision.legacyEnabled,
    policy_version: policyVersion,
    portfolio_mode: settings.sourcePortfolioMode,
    proposed_selected: decision.proposedSelected,
    reader_source_id: decision.sourceId,
    reasons: decision.reasons,
    role: decision.role,
    score: decision.score,
    score_components: decision.scoreComponents,
  }));
  const { error: insertError } = await supabase.from("digest_run_source_decisions").upsert(rows, {
    onConflict: "digest_run_id,reader_source_id",
  });
  if (insertError) throw insertError;

  return { decisions, mode: settings.sourcePortfolioMode, sources: sourcesForFrozenDecisions(sources, decisions) };
}
