import "server-only";

import type { Database, Json } from "../../database.types";
import { getDigestSettingsForRun, type ReaderDigestSettings } from "../../digest-settings";
import { readerFeedForCategory, type ReaderFeedId } from "../../feed-categories";
import { keywordHitCount, matchingKeywords, textMatchesAnyKeyword } from "../../keyword-matching";
import { feedbackScoreAdjustment, getFeedbackProfileForUser } from "../../reader-feedback";
import {
  DIGEST_RECOMMENDATION_POLICY_VERSION,
  hardEligibilityReasons,
  selectDigestRecommendations,
  type DigestRecommendationDecision,
} from "../../recommendation-policy";
import { getRecommendationPolicyGate } from "../../recommendation-policy-server";
import { createSupabaseAdminClient } from "../../supabase";
import { buildDedupeProfile, duplicateDecision } from "../dedupe";
import {
  ACTIONABILITY_KEYWORDS,
  BUILD_RELEVANCE_KEYWORDS,
  HIGH_PRIORITY_ENTITIES,
  IMPORTANT_KEYWORDS,
  SCOPE_KEYWORDS,
  SUPABASE_WRITE_BATCH_SIZE,
} from "../constants";
import type { StageRunner } from "../types";
import { chunk, jsonNumber, jsonString, jsonStringArray } from "../utils";

type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
type ContentFeed = Exclude<ReaderFeedId, "all">;

const FEED_SELECTION_ORDER: ContentFeed[] = ["geopolitics", "business", "ai", "software", "security"];
const DIGEST_SELECTION_POLICY_VERSION = "digest-selection-v1";

type PracticalBucket =
  | "build_opportunity"
  | "product_trend"
  | "market_risk"
  | "security_risk"
  | "regulatory_risk"
  | "competitive_intelligence"
  | "investment_signal"
  | "geopolitical_risk"
  | "infrastructure_outage"
  | "ignore";

const MAJOR_SECURITY_KEYWORDS = [
  "active exploit",
  "actively exploited",
  "breach",
  "critical",
  "cisa",
  "data leak",
  "emergency patch",
  "exploited in the wild",
  "major outage",
  "nation-state",
  "ransomware",
  "supply chain",
  "zero-day",
  "0-day",
];

const DEVELOPER_SECURITY_KEYWORDS = [
  "api",
  "cloud",
  "cloudflare",
  "cve",
  "developer",
  "github",
  "infrastructure",
  "kubernetes",
  "npm",
  "open source",
  "package",
  "patch",
  "python",
  "registry",
  "sdk",
  "software supply chain",
  "vulnerability",
];

const GEOPOLITICS_BUSINESS_SECURITY_KEYWORDS = [
  "sanction",
  "sanctions",
  "export control",
  "export controls",
  "war",
  "taiwan",
  "china",
  "russia",
  "ukraine",
  "energy",
  "chip",
  "chips",
  "semiconductor",
  "nato",
  "tariff",
  "tariffs",
];

const BUCKET_KEYWORDS: Record<PracticalBucket, string[]> = {
  build_opportunity: [
    "agent",
    "agents",
    "api",
    "sdk",
    "developer",
    "devtool",
    "devtools",
    "github",
    "open source",
    "integration",
    "framework",
    "workflow",
  ],
  product_trend: ["launch", "release", "rollout", "preview", "beta", "model", "llm", "ai", "feature"],
  market_risk: ["fed", "ecb", "rate", "rates", "inflation", "recession", "selloff", "market", "markets", "yield"],
  security_risk: [
    "breach",
    "cve",
    "exploit",
    "ransomware",
    "security",
    "vulnerability",
    "zero-day",
    "0-day",
    "data leak",
  ],
  regulatory_risk: ["antitrust", "ban", "compliance", "export control", "export controls", "regulation", "sanction"],
  competitive_intelligence: [
    "acquisition",
    "anthropic",
    "competitor",
    "deepmind",
    "microsoft",
    "openai",
    "partnership",
    "pricing",
    "startup",
  ],
  investment_signal: ["earnings", "funding", "ipo", "revenue", "valuation", "venture", "guidance", "capex"],
  geopolitical_risk: ["china", "nato", "russia", "taiwan", "ukraine", "war", "sanction", "tariff", "energy"],
  infrastructure_outage: ["cloud outage", "dns", "incident", "latency", "outage", "region down", "service disruption"],
  ignore: [],
};

const PRACTICAL_BUCKET_PRIORITY: Exclude<PracticalBucket, "ignore">[] = [
  "infrastructure_outage",
  "security_risk",
  "regulatory_risk",
  "geopolitical_risk",
  "market_risk",
  "investment_signal",
  "build_opportunity",
  "competitive_intelligence",
  "product_trend",
];

async function loadRunSnapshots(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("story_snapshots")
    .select("*")
    .eq("digest_run_id", digestRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function loadSnapshotArticles(snapshots: StorySnapshotRow[]) {
  const articleIds = [...new Set(snapshots.flatMap((snapshot) => jsonStringArray(snapshot.metadata, "articleIds")))];
  const supabase = createSupabaseAdminClient();
  const articles = new Map<string, ArticleRow>();

  for (const articleIdBatch of chunk(articleIds, 40)) {
    const { data, error } = await supabase.from("articles").select("*").in("id", articleIdBatch);
    if (error) throw error;
    for (const article of data || []) articles.set(article.id, article);
  }

  return articles;
}

function bestReadableArticle(snapshot: StorySnapshotRow, articles: Map<string, ArticleRow>) {
  return jsonStringArray(snapshot.metadata, "articleIds")
    .flatMap((articleId) => {
      const article = articles.get(articleId);
      return article?.content_mode === "readable" ? [article] : [];
    })
    .sort((left, right) => {
      const priority = jsonNumber(right.metadata, "sourcePriority") - jsonNumber(left.metadata, "sourcePriority");
      const textLength = (right.enriched_text || "").length - (left.enriched_text || "").length;
      return priority || textLength;
    })[0];
}

function snapshotWithReadableVariant(snapshot: StorySnapshotRow, articles: Map<string, ArticleRow>) {
  const articleIds = jsonStringArray(snapshot.metadata, "articleIds");
  const contentModes = [...new Set(articleIds.flatMap((articleId) => {
    const article = articles.get(articleId);
    return article ? [article.content_mode] : [];
  }))];
  const readableArticle = bestReadableArticle(snapshot, articles);

  if (!readableArticle) {
    return { contentModes, hasReadableVariant: false, snapshot };
  }

  return {
    contentModes,
    hasReadableVariant: true,
    snapshot: {
      ...snapshot,
      metadata: {
        ...jsonRecord(snapshot.metadata),
        canonicalArticleId: readableArticle.id,
        canonicalUrl: readableArticle.canonical_url,
        category: readableArticle.category,
        contentMode: readableArticle.content_mode,
        publishedAt: readableArticle.last_seen_at || readableArticle.first_seen_at,
        source: readableArticle.source,
        sourcePriority: jsonNumber(readableArticle.metadata, "sourcePriority"),
        summary: readableArticle.enriched_description || readableArticle.raw_summary,
        title: readableArticle.enriched_title || readableArticle.title,
      },
    },
  };
}

function textIncludesAny(text: string, keywords: string[]) {
  return textMatchesAnyKeyword(text, keywords);
}

function keywordHits(text: string, keywords: string[]) {
  return matchingKeywords(text, keywords);
}

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function securityStoryIsMajor(snapshot: StorySnapshotRow, text: string) {
  return snapshot.duplicate_count >= 3 || textIncludesAny(text, MAJOR_SECURITY_KEYWORDS);
}

function securityStoryIsDeveloperRelevant(text: string) {
  return textIncludesAny(text, [...DEVELOPER_SECURITY_KEYWORDS, ...BUILD_RELEVANCE_KEYWORDS]);
}

function geopoliticsStoryAffectsBusinessSecurityChipsEnergy(text: string) {
  return textIncludesAny(text, GEOPOLITICS_BUSINESS_SECURITY_KEYWORDS);
}

function actionabilityScoreForText(text: string) {
  const hits = keywordHits(text, ACTIONABILITY_KEYWORDS).length;
  const entityHits = keywordHits(text, HIGH_PRIORITY_ENTITIES).length;
  const buildHits = keywordHits(text, BUILD_RELEVANCE_KEYWORDS).length;

  return Math.max(1, Math.min(10, 2 + hits + Math.min(3, entityHits) + Math.min(2, buildHits)));
}

function feedScoreAdjustment(
  feed: ContentFeed,
  options: { geopoliticsIsRelevant: boolean; isDeveloperSecurity: boolean; isMajorSecurity: boolean },
) {
  if (feed === "geopolitics") {
    return options.geopoliticsIsRelevant ? 10 : -12;
  }

  if (feed === "business") {
    return 6;
  }

  if (feed === "security") {
    if (options.isMajorSecurity) {
      return 16;
    }

    return options.isDeveloperSecurity ? 5 : -25;
  }

  return 0;
}

function classifyPracticalBucket(text: string): PracticalBucket {
  for (const bucket of PRACTICAL_BUCKET_PRIORITY) {
    if (keywordHits(text, BUCKET_KEYWORDS[bucket]).length > 0) {
      return bucket;
    }
  }

  return textIncludesAny(text, SCOPE_KEYWORDS) ? "product_trend" : "ignore";
}

function humanBucket(bucket: PracticalBucket) {
  return bucket.replace(/_/g, " ");
}

function recommendedActionForBucket(bucket: PracticalBucket) {
  switch (bucket) {
    case "build_opportunity":
      return "Check whether this creates a product, automation, or integration opportunity.";
    case "product_trend":
      return "Track adoption and compare against current AI/product roadmap assumptions.";
    case "market_risk":
      return "Watch second-order effects on tech valuations, budgets, and customer spend.";
    case "security_risk":
      return "Review exposure, patches, dependencies, and vendor advisories.";
    case "regulatory_risk":
      return "Assess impact on go-to-market, vendor access, chips, data, or compliance.";
    case "competitive_intelligence":
      return "Compare positioning, pricing, distribution, and partnership implications.";
    case "investment_signal":
      return "Use as a signal for capital flows, startup demand, or public-market sentiment.";
    case "geopolitical_risk":
      return "Monitor business impact on supply chains, chips, energy, sanctions, or security.";
    case "infrastructure_outage":
      return "Check dependency status pages and incident reports if this touches your stack.";
    case "ignore":
      return "No action recommended unless the story becomes more directly relevant.";
  }
}

function uniqueHits(hits: string[]) {
  return Array.from(new Set(hits.map((hit) => hit.trim()).filter(Boolean)));
}

export function selectionReasonForStory({
  bucket,
  feed,
  feedbackAdjustment,
  feedAdjustment,
  geopoliticsIsRelevant,
  isDeveloperSecurity,
  isMajorSecurity,
  scores,
  text,
}: {
  bucket: PracticalBucket;
  feed: ContentFeed;
  feedbackAdjustment: number;
  feedAdjustment: number;
  geopoliticsIsRelevant: boolean;
  isDeveloperSecurity: boolean;
  isMajorSecurity: boolean;
  scores: Omit<ReturnType<typeof scoreSnapshot>, "ageHours">;
  text: string;
}) {
  const hits = uniqueHits(
    keywordHits(text, [
      ...HIGH_PRIORITY_ENTITIES,
      ...BUILD_RELEVANCE_KEYWORDS,
      ...ACTIONABILITY_KEYWORDS,
    ]),
  ).slice(0, 5);
  const strongScores = [
    { label: "scope fit", value: scores.scopeFitScore },
    { label: "actionability", value: scores.actionabilityScore },
    { label: "impact", value: scores.impactScore },
    { label: "urgency", value: scores.urgencyScore },
    { label: "confirmation", value: scores.confirmationScore },
  ]
    .filter((score) => score.value >= 7)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((score) => `${score.label} ${score.value}/10`);
  const reasons = [
    hits.length ? `matched ${hits.join(", ")}` : null,
    strongScores.length ? `scored high on ${strongScores.join(", ")}` : null,
    feedAdjustment > 0 ? `fits the ${feed} feed target` : null,
    feedbackAdjustment > 0 ? "matches previous positive feedback" : null,
    isMajorSecurity ? "major security signal" : null,
    !isMajorSecurity && isDeveloperSecurity ? "developer-relevant security signal" : null,
    geopoliticsIsRelevant ? "geopolitics with business, chips, energy, or security impact" : null,
  ].filter(Boolean);

  return `Selected as ${humanBucket(bucket)}${reasons.length ? `: ${reasons.join("; ")}` : ""}.`;
}

function scoreSnapshot(snapshot: StorySnapshotRow, settings: ReaderDigestSettings) {
  const title = jsonString(snapshot.metadata, "title");
  const summary = jsonString(snapshot.metadata, "summary");
  const category = jsonString(snapshot.metadata, "category");
  const publishedAt = jsonString(snapshot.metadata, "publishedAt");
  const sourcePriority = Math.max(0, Math.min(5, jsonNumber(snapshot.metadata, "sourcePriority")));
  const text = `${title} ${summary} ${category}`;
  const preferredKeywordHits = keywordHitCount(text, settings.preferredKeywords);
  const impactScore = Math.max(
    1,
    Math.min(
      10,
      2 + keywordHitCount(text, IMPORTANT_KEYWORDS) + preferredKeywordHits,
    ),
  );
  const confirmationScore = Math.min(10, snapshot.duplicate_count >= 5 ? 10 : snapshot.duplicate_count * 3);
  const scopeFitScore = textIncludesAny(text, [...SCOPE_KEYWORDS, ...settings.preferredKeywords]) ? 9 : 4;
  const actionabilityScore = actionabilityScoreForText(text);
  const publishedTimestamp = Date.parse(publishedAt);
  const ageHours = Number.isNaN(publishedTimestamp) ? 72 : (Date.now() - publishedTimestamp) / 3_600_000;
  const urgencyScore = ageHours <= 6 ? 10 : ageHours <= 24 ? 8 : ageHours <= 72 ? 5 : 3;
  const changedFields = jsonStringArray(snapshot.changed_fields);
  const noveltyScore = changedFields.includes("new") ? 10 : changedFields.length ? 7 : 2;
  const editorialScore = Math.round(
    impactScore * 2.4 +
      noveltyScore * 1.6 +
      confirmationScore * 1.4 +
      scopeFitScore * 2.4 +
      actionabilityScore * 1.7 +
      urgencyScore * 1.2 +
      sourcePriority * 1.5,
  );

  return {
    actionabilityScore,
    ageHours,
    confirmationScore,
    editorialScore,
    impactScore,
    noveltyScore,
    scopeFitScore,
    urgencyScore,
  };
}

export function eligibilityReasonsForStory(input: {
  ageHours: number;
  duplicateCount: number;
  editorialScore: number;
  feed: ContentFeed;
  freshnessWindowHours: number;
  hasReadableVariant: boolean;
  isDeveloperSecurity: boolean;
  isExcluded: boolean;
  isMajorSecurity: boolean;
  minimumImportanceScore: number;
  minimumSourceCount: number;
  noveltyScore: number;
  readableOnly: boolean;
  requireMajorSecurity: boolean;
}) {
  return hardEligibilityReasons(input);
}

export const runEditorialScoringStage: StageRunner = async ({ digestRunId }) => {
  const supabase = createSupabaseAdminClient();
  const [settings, snapshots] = await Promise.all([
    getDigestSettingsForRun(digestRunId),
    loadRunSnapshots(digestRunId),
  ]);
  const [{ data: run, error: runError }, articles] = await Promise.all([
    supabase.from("digest_runs").select("started_by_user_id").eq("id", digestRunId).maybeSingle(),
    loadSnapshotArticles(snapshots),
  ]);
  if (runError) throw runError;
  const feedbackProfile = settings.personalizationEnabled
    ? await getFeedbackProfileForUser(run?.started_by_user_id || null, {
        includeImplicit: settings.implicitPersonalizationEnabled,
      })
    : null;
  const recommendationGate = settings.recommendationPolicyMode === "v2"
    ? await getRecommendationPolicyGate().catch(() => null)
    : null;
  const recommendationV2Active = settings.recommendationPolicyMode === "v2" && recommendationGate?.passed === true;
  const clusterIds = snapshots.map((snapshot) => snapshot.story_cluster_id);
  const { data: clusterRows, error: clusterError } = clusterIds.length
    ? await supabase.from("story_clusters").select("id, latest_scores").in("id", clusterIds)
    : { data: [], error: null };

  if (clusterError) {
    throw clusterError;
  }

  const previousScoresByClusterId = new Map((clusterRows || []).map((cluster) => [cluster.id, cluster.latest_scores]));
  const scored = snapshots
    .map((rawSnapshot) => {
      const prepared = snapshotWithReadableVariant(rawSnapshot, articles);
      const snapshot = prepared.snapshot;
      const scores = scoreSnapshot(snapshot, settings);
      const title = jsonString(snapshot.metadata, "title");
      const summary = jsonString(snapshot.metadata, "summary");
      const category = jsonString(snapshot.metadata, "category");
      const publishedAt = jsonString(snapshot.metadata, "publishedAt");
      const source = jsonString(snapshot.metadata, "source");
      const normalizedSource = source.trim().toLowerCase();
      const feed = readerFeedForCategory(category);
      const text = `${title} ${summary} ${category}`;
      const isMajorSecurity = feed === "security" ? securityStoryIsMajor(snapshot, text) : false;
      const isDeveloperSecurity = feed === "security" ? securityStoryIsDeveloperRelevant(text) : false;
      const geopoliticsIsRelevant =
        feed === "geopolitics" ? geopoliticsStoryAffectsBusinessSecurityChipsEnergy(text) : false;
      const excludedKeywordPenalty = textIncludesAny(text, settings.excludedKeywords) ? 80 : 0;
      const feedbackAdjustment = feedbackProfile
        ? feedbackScoreAdjustment(feedbackProfile, {
            category,
            source,
            storyClusterId: snapshot.story_cluster_id,
            text,
          })
        : 0;
      const practicalBucket = classifyPracticalBucket(text);
      const feedAdjustment = feedScoreAdjustment(feed, {
        geopoliticsIsRelevant,
        isDeveloperSecurity,
        isMajorSecurity,
      });
      const dedupeProfile = buildDedupeProfile({
        canonicalUrl: jsonString(snapshot.metadata, "canonicalUrl"),
        category,
        id: snapshot.id,
        publishedAt,
        source,
        summary,
        title,
      });

      const previousEditorialScore = jsonNumber(previousScoresByClusterId.get(snapshot.story_cluster_id) || {}, "editorial");
      const changedFields = jsonStringArray(snapshot.changed_fields);

      if (previousEditorialScore > 0 && Math.abs(previousEditorialScore - scores.editorialScore) >= 10) {
        changedFields.push("score");
        if (scores.noveltyScore <= 2) {
          scores.noveltyScore = 7;
          scores.editorialScore += 8;
        }
      }

      return {
        changedFields: Array.from(new Set(changedFields)),
        contentModes: prepared.contentModes,
        dedupeProfile,
        feedbackAdjustment,
        feed,
        feedAdjustment,
        geopoliticsIsRelevant,
        isDeveloperSecurity,
        hasReadableVariant: prepared.hasReadableVariant,
        isExcluded: excludedKeywordPenalty > 0,
        isMajorSecurity,
        practicalBucket,
        normalizedSource,
        scores,
        selectionScore: scores.editorialScore + feedAdjustment + feedbackAdjustment - excludedKeywordPenalty,
        snapshot,
      };
    })
    .sort((left, right) => right.selectionScore - left.selectionScore);
  const eligibilityReasonsBySnapshotId = new Map(
    scored.map((item) => [
      item.snapshot.id,
      eligibilityReasonsForStory({
        ageHours: item.scores.ageHours,
        duplicateCount: item.snapshot.duplicate_count,
        editorialScore: item.scores.editorialScore,
        feed: item.feed,
        freshnessWindowHours: settings.freshnessWindowHours,
        hasReadableVariant: item.hasReadableVariant,
        isDeveloperSecurity: item.isDeveloperSecurity,
        isExcluded: item.isExcluded,
        isMajorSecurity: item.isMajorSecurity,
        minimumImportanceScore: settings.minimumImportanceScore,
        minimumSourceCount: settings.minimumSourceCount,
        noveltyScore: item.scores.noveltyScore,
        readableOnly: settings.readableOnly,
        requireMajorSecurity: settings.requireMajorSecurity,
      }),
    ]),
  );
  const candidates = scored.filter((item) => !eligibilityReasonsBySnapshotId.get(item.snapshot.id)?.length);
  const selectedIds = new Set<string>();
  const selectedItems: typeof scored = [];
  const suppressedDuplicates = new Map<string, { duplicateOfSnapshotId: string; reason: string; score: number }>();
  const selectionReasonsBySnapshotId = new Map<string, string[]>();
  const selectedCounts: Record<ContentFeed, number> = {
    geopolitics: 0,
    business: 0,
    ai: 0,
    software: 0,
    security: 0,
  };
  const selectedSourceCounts = new Map<string, number>();

  function addSelectionReason(snapshotId: string, reason: string) {
    const reasons = selectionReasonsBySnapshotId.get(snapshotId) || [];
    if (!reasons.includes(reason)) reasons.push(reason);
    selectionReasonsBySnapshotId.set(snapshotId, reasons);
  }

  function selectItem(item: (typeof scored)[number], selectedReason: "feed_target" | "global_rank") {
    if (selectedIds.has(item.snapshot.id)) {
      return;
    }
    if (selectedIds.size >= settings.publishTopN) {
      addSelectionReason(item.snapshot.id, "capacity");
      return;
    }

    if (
      item.normalizedSource &&
      (selectedSourceCounts.get(item.normalizedSource) ?? 0) >= settings.maxStoriesPerSource
    ) {
      addSelectionReason(item.snapshot.id, "publisher_cap");
      return;
    }

    for (const selected of selectedItems) {
      const decision = duplicateDecision(item.dedupeProfile, selected.dedupeProfile);

      if (decision.duplicate) {
        suppressedDuplicates.set(item.snapshot.id, {
          duplicateOfSnapshotId: selected.snapshot.id,
          reason: decision.reason,
          score: Number(decision.score.toFixed(3)),
        });
        addSelectionReason(item.snapshot.id, "duplicate_suppression");
        return;
      }
    }

    selectedIds.add(item.snapshot.id);
    selectedItems.push(item);
    addSelectionReason(item.snapshot.id, selectedReason);
    selectedCounts[item.feed] += 1;
    if (item.normalizedSource) {
      selectedSourceCounts.set(item.normalizedSource, (selectedSourceCounts.get(item.normalizedSource) ?? 0) + 1);
    }
  }

  for (const feed of FEED_SELECTION_ORDER) {
    const feedCandidates = candidates.filter((item) => item.feed === feed);

    for (const item of feedCandidates) {
      if (selectedCounts[feed] >= settings.feedTargets[feed]) {
        break;
      }

      selectItem(item, "feed_target");
    }
  }

  for (const item of candidates) {
    if (selectedIds.has(item.snapshot.id)) {
      continue;
    }
    if (item.feed === "security" && selectedCounts.security >= settings.feedTargets.security) {
      addSelectionReason(item.snapshot.id, "security_quota");
      continue;
    }

    selectItem(item, "global_rank");
  }

  const selectionRankBySnapshotId = new Map(selectedItems.map((item, index) => [item.snapshot.id, index]));
  const recommendationDecisions: Database["public"]["Tables"]["digest_recommendation_decisions"]["Insert"][] =
    scored.map((item, candidateRank) => {
      const eligibilityReasons = eligibilityReasonsBySnapshotId.get(item.snapshot.id) || [];
      return {
        candidate_rank: candidateRank,
        digest_run_id: digestRunId,
        eligibility_reasons: eligibilityReasons,
        eligible: eligibilityReasons.length === 0,
        policy_version: DIGEST_SELECTION_POLICY_VERSION,
        recommendation_reasons: [selectionReasonForStory({
          bucket: item.practicalBucket,
          feed: item.feed,
          feedbackAdjustment: item.feedbackAdjustment,
          feedAdjustment: item.feedAdjustment,
          geopoliticsIsRelevant: item.geopoliticsIsRelevant,
          isDeveloperSecurity: item.isDeveloperSecurity,
          isMajorSecurity: item.isMajorSecurity,
          scores: item.scores,
          text: `${jsonString(item.snapshot.metadata, "title")} ${jsonString(item.snapshot.metadata, "summary")} ${jsonString(item.snapshot.metadata, "category")}`,
        }).replace(/^Selected as/, "Scored as")],
        score: item.selectionScore,
        score_components: {
          actionability: item.scores.actionabilityScore,
          confirmation: item.scores.confirmationScore,
          editorial: item.scores.editorialScore,
          feedbackAdjustment: item.feedbackAdjustment,
          feed: item.feed,
          feedAdjustment: item.feedAdjustment,
          impact: item.scores.impactScore,
          novelty: item.scores.noveltyScore,
          scopeFit: item.scores.scopeFitScore,
          urgency: item.scores.urgencyScore,
        },
        selected: selectedIds.has(item.snapshot.id),
        selection_rank: selectionRankBySnapshotId.get(item.snapshot.id) ?? null,
        selection_reasons: selectionReasonsBySnapshotId.get(item.snapshot.id) || [],
        story_cluster_id: item.snapshot.story_cluster_id,
      };
    });

  const v2Selection = selectDigestRecommendations({
    candidates: scored.map((item) => ({
      dedupeProfile: item.dedupeProfile,
      eligibilityReasons: eligibilityReasonsBySnapshotId.get(item.snapshot.id) || [],
      feed: item.feed,
      feedAdjustment: item.feedAdjustment,
      id: item.snapshot.id,
      normalizedSource: item.normalizedSource,
      objectiveComponents: {
        actionability: item.scores.actionabilityScore,
        confirmation: item.scores.confirmationScore,
        editorial: item.scores.editorialScore,
        impact: item.scores.impactScore,
        novelty: item.scores.noveltyScore,
        scopeFit: item.scores.scopeFitScore,
        urgency: item.scores.urgencyScore,
      },
      objectiveReasons: [selectionReasonForStory({
        bucket: item.practicalBucket,
        feed: item.feed,
        feedbackAdjustment: 0,
        feedAdjustment: item.feedAdjustment,
        geopoliticsIsRelevant: item.geopoliticsIsRelevant,
        isDeveloperSecurity: item.isDeveloperSecurity,
        isMajorSecurity: item.isMajorSecurity,
        scores: item.scores,
        text: `${jsonString(item.snapshot.metadata, "title")} ${jsonString(item.snapshot.metadata, "summary")} ${jsonString(item.snapshot.metadata, "category")}`,
      }).replace(/^Selected as/, "Scored as")],
      objectiveScore: item.scores.editorialScore,
      preferenceAdjustment: item.feedbackAdjustment,
      storyClusterId: item.snapshot.story_cluster_id,
    })),
    feedTargets: settings.feedTargets,
    maxStoriesPerSource: settings.maxStoriesPerSource,
    publishTopN: settings.publishTopN,
  });
  const v2DecisionBySnapshotId = new Map(v2Selection.decisions.map((decision) => [decision.id, decision]));
  const v2RecommendationDecisions: Database["public"]["Tables"]["digest_recommendation_decisions"]["Insert"][] =
    v2Selection.decisions.map((decision) => ({
      candidate_rank: decision.candidateRank,
      digest_run_id: digestRunId,
      eligibility_reasons: decision.eligibilityReasons,
      eligible: decision.eligible,
      policy_version: DIGEST_RECOMMENDATION_POLICY_VERSION,
      recommendation_reasons: decision.recommendationReasons,
      score: decision.score,
      score_components: decision.scoreComponents,
      selected: decision.selected,
      selection_rank: decision.selectionRank,
      selection_reasons: decision.selectionReasons,
      story_cluster_id: decision.storyClusterId,
    }));

  if (recommendationV2Active) {
    selectedIds.clear();
    selectedItems.splice(0, selectedItems.length);
    selectionReasonsBySnapshotId.clear();
    suppressedDuplicates.clear();
    for (const feed of FEED_SELECTION_ORDER) selectedCounts[feed] = v2Selection.selectedFeedCounts[feed];
    const scoredById = new Map(scored.map((item) => [item.snapshot.id, item]));
    for (const snapshotId of v2Selection.orderedSelectedIds) {
      const item = scoredById.get(snapshotId);
      if (!item) continue;
      selectedIds.add(snapshotId);
      selectedItems.push(item);
    }
    for (const decision of v2Selection.decisions) {
      selectionReasonsBySnapshotId.set(decision.id, decision.selectionReasons);
      if (decision.duplicateOfCandidateId && decision.duplicateReason && decision.duplicateScore !== null) {
        suppressedDuplicates.set(decision.id, {
          duplicateOfSnapshotId: decision.duplicateOfCandidateId,
          reason: decision.duplicateReason,
          score: decision.duplicateScore,
        });
      }
    }
  }

  for (const decisionBatch of chunk(
    [...recommendationDecisions, ...v2RecommendationDecisions],
    SUPABASE_WRITE_BATCH_SIZE,
  )) {
    const { error: decisionError } = await supabase
      .from("digest_recommendation_decisions")
      .upsert(decisionBatch, { onConflict: "digest_run_id,story_cluster_id,policy_version" });
    if (decisionError) throw decisionError;
  }

  const selectedStoriesBySource = new Map<
    string,
    { readerSourceId: string | null; sourceUrl: string; storyIds: Set<string> }
  >();
  for (const item of selectedItems) {
    const sourceVariants = jsonRecord(item.snapshot.metadata).sourceVariants;
    if (!Array.isArray(sourceVariants)) continue;
    for (const variant of sourceVariants) {
      const sourceFeedUrl = jsonString(variant, "sourceFeedUrl");
      if (!sourceFeedUrl) continue;
      const readerSourceId = jsonString(variant, "readerSourceId") || null;
      const sourceKey = readerSourceId ? `id:${readerSourceId}` : `url:${sourceFeedUrl}`;
      const source = selectedStoriesBySource.get(sourceKey) || {
        readerSourceId,
        sourceUrl: sourceFeedUrl,
        storyIds: new Set<string>(),
      };
      source.storyIds.add(item.snapshot.story_cluster_id);
      selectedStoriesBySource.set(sourceKey, source);
    }
  }
  await Promise.all(
    [...selectedStoriesBySource.values()].map(async (source) => {
      let update = supabase
        .from("source_run_observations")
        .update({ selected_story_count: source.storyIds.size })
        .eq("digest_run_id", digestRunId);
      update = source.readerSourceId
        ? update.eq("reader_source_id", source.readerSourceId)
        : update.eq("source_url", source.sourceUrl);
      const { error } = await update;
      if (error) throw error;
    }),
  );

  const scoredSnapshots: StorySnapshotInsert[] = scored.map(
    ({
      changedFields,
      contentModes,
      dedupeProfile: _dedupeProfile,
      feedbackAdjustment,
      feed,
      feedAdjustment,
      geopoliticsIsRelevant,
      isDeveloperSecurity,
      hasReadableVariant,
      isMajorSecurity,
      practicalBucket,
      normalizedSource: _normalizedSource,
      scores,
      selectionScore,
      snapshot,
    }) => {
      const duplicateSuppression = suppressedDuplicates.get(snapshot.id);
      const activeV2Decision: DigestRecommendationDecision | undefined = recommendationV2Active
        ? v2DecisionBySnapshotId.get(snapshot.id)
        : undefined;
      const effectiveFeedbackAdjustment = activeV2Decision?.preferenceAdjustment ?? feedbackAdjustment;
      const effectiveSelectionScore = activeV2Decision?.score ?? selectionScore;

      return {
        ...snapshot,
        changed_fields: changedFields,
        confirmation_score: scores.confirmationScore,
        editorial_score: scores.editorialScore,
        impact_score: scores.impactScore,
        is_selected: selectedIds.has(snapshot.id),
        metadata: {
          ...jsonRecord(snapshot.metadata),
          ...(duplicateSuppression ? { duplicateSuppression } : {}),
          contentModes,
          hasReadableVariant,
          isDeveloperSecurity,
          isMajorSecurity,
          practicalBucket,
          recommendedAction: recommendedActionForBucket(practicalBucket),
          scoreComponents: {
            actionability: scores.actionabilityScore,
            confirmation: scores.confirmationScore,
            editorial: scores.editorialScore,
            feedbackAdjustment: effectiveFeedbackAdjustment,
            personalizationEvidenceCount: feedbackProfile?.evidenceCount || 0,
            feed,
            feedAdjustment,
            geopoliticsIsRelevant,
            impact: scores.impactScore,
            novelty: scores.noveltyScore,
            scopeFit: scores.scopeFitScore,
            selection: effectiveSelectionScore,
            sourcePriority: Math.max(0, Math.min(5, jsonNumber(snapshot.metadata, "sourcePriority"))),
            urgency: scores.urgencyScore,
          },
          whyInteresting: selectionReasonForStory({
            bucket: practicalBucket,
            feed,
            feedbackAdjustment: effectiveFeedbackAdjustment,
            feedAdjustment,
            geopoliticsIsRelevant,
            isDeveloperSecurity,
            isMajorSecurity,
            scores,
            text: `${jsonString(snapshot.metadata, "title")} ${jsonString(
              snapshot.metadata,
              "summary",
            )} ${jsonString(snapshot.metadata, "category")}`,
          }),
        },
        novelty_score: scores.noveltyScore,
        scope_fit_score: scores.scopeFitScore,
        urgency_score: scores.urgencyScore,
      };
    },
  );

  for (const snapshotBatch of chunk(scoredSnapshots, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error } = await supabase.from("story_snapshots").upsert(snapshotBatch, {
      onConflict: "id",
    });

    if (error) {
      throw error;
    }
  }

  const selectedStoryUpdates: Database["public"]["Tables"]["story_updates"]["Insert"][] = selectedItems.map(
    (item) => ({
      changed_fields: item.changedFields,
      digest_run_id: digestRunId,
      snapshot: {
        category: jsonString(item.snapshot.metadata, "category"),
        editorialScore: item.scores.editorialScore,
        publishedAt: jsonString(item.snapshot.metadata, "publishedAt"),
        source: jsonString(item.snapshot.metadata, "source"),
        summary: jsonString(item.snapshot.metadata, "summary"),
        title: jsonString(item.snapshot.metadata, "title"),
      },
      story_cluster_id: item.snapshot.story_cluster_id,
    }),
  );

  for (const updateBatch of chunk(selectedStoryUpdates, SUPABASE_WRITE_BATCH_SIZE)) {
    const { error: updateError } = await supabase.from("story_updates").upsert(updateBatch, {
      onConflict: "story_cluster_id,digest_run_id",
    });

    if (updateError) {
      throw updateError;
    }
  }

  for (const itemBatch of chunk(selectedItems, SUPABASE_WRITE_BATCH_SIZE)) {
    await Promise.all(
      itemBatch.map(async (item) => {
        const { error: scoreError } = await supabase
          .from("story_clusters")
          .update({
            canonical_title: jsonString(item.snapshot.metadata, "title"),
            canonical_url: jsonString(item.snapshot.metadata, "canonicalUrl"),
            latest_scores: {
              editorial: item.scores.editorialScore,
              impact: item.scores.impactScore,
              novelty: item.scores.noveltyScore,
              selection: recommendationV2Active
                ? v2DecisionBySnapshotId.get(item.snapshot.id)?.score ?? item.selectionScore
                : item.selectionScore,
            },
            latest_summary: jsonString(item.snapshot.metadata, "summary"),
            source: jsonString(item.snapshot.metadata, "source"),
          })
          .eq("id", item.snapshot.story_cluster_id);

        if (scoreError) throw scoreError;
        const canonicalArticleId = jsonString(item.snapshot.metadata, "canonicalArticleId");
        if (canonicalArticleId) {
          const { error: clearCanonicalError } = await supabase
            .from("story_cluster_articles")
            .update({ is_canonical: false })
            .eq("story_cluster_id", item.snapshot.story_cluster_id);
          if (clearCanonicalError) throw clearCanonicalError;
          const { error: canonicalError } = await supabase
            .from("story_cluster_articles")
            .update({ is_canonical: true })
            .eq("story_cluster_id", item.snapshot.story_cluster_id)
            .eq("article_id", canonicalArticleId);
          if (canonicalError) throw canonicalError;
        }
      }),
    );
  }

  return {
    metrics: {
      activeRecommendationPolicy: recommendationV2Active
        ? DIGEST_RECOMMENDATION_POLICY_VERSION
        : DIGEST_SELECTION_POLICY_VERSION,
      recommendationPolicyMode: settings.recommendationPolicyMode,
      recommendationV2GatePassed: recommendationGate?.passed ?? false,
      selectedCount: selectedIds.size,
      selectedFeedCounts: selectedCounts,
      suppressedDuplicateCount: suppressedDuplicates.size,
      settings: {
        minimumImportanceScore: settings.minimumImportanceScore,
        freshnessWindowHours: settings.freshnessWindowHours,
        maxStoriesPerSource: settings.maxStoriesPerSource,
        minimumSourceCount: settings.minimumSourceCount,
        publishTopN: settings.publishTopN,
        readableOnly: settings.readableOnly,
        requireMajorSecurity: settings.requireMajorSecurity,
      },
      feedbackAdjustedCount: scored.filter((item) => item.feedbackAdjustment !== 0).length,
      personalizationEvidenceCount: feedbackProfile?.evidenceCount || 0,
      skippedWithoutReadableTextCount: settings.readableOnly
        ? scored.filter((item) => !item.hasReadableVariant).length
        : 0,
      skippedNonMajorSecurityCount: settings.requireMajorSecurity
        ? scored.filter((item) => item.feed === "security" && !item.isMajorSecurity && !item.isDeveloperSecurity).length
        : 0,
      storyCount: snapshots.length,
    },
  };
};
