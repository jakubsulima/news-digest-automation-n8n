import "server-only";

import type { Database, Json } from "../../database.types";
import { getDigestSettingsForRun, type ReaderDigestSettings } from "../../digest-settings";
import { readerFeedForCategory, type ReaderFeedId } from "../../feed-categories";
import { feedbackScoreAdjustment, getFeedbackProfileForUser } from "../../reader-feedback";
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
import { chunk, jsonNumber, jsonString } from "../utils";

type StorySnapshotInsert = Database["public"]["Tables"]["story_snapshots"]["Insert"];
type StorySnapshotRow = Database["public"]["Tables"]["story_snapshots"]["Row"];
type ContentFeed = Exclude<ReaderFeedId, "all">;

const FEED_SELECTION_ORDER: ContentFeed[] = ["geopolitics", "business", "ai", "software", "security"];

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

async function loadRunStartedByUserId(digestRunId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("digest_runs")
    .select("started_by_user_id")
    .eq("id", digestRunId)
    .maybeSingle<Pick<Database["public"]["Tables"]["digest_runs"]["Row"], "started_by_user_id">>();

  if (error) {
    throw error;
  }

  return data?.started_by_user_id ?? null;
}

function textIncludesAny(text: string, keywords: string[]) {
  const lower = text.toLowerCase();

  return keywords.some((keyword) => lower.includes(keyword));
}

function keywordHits(text: string, keywords: string[]) {
  const lower = text.toLowerCase();

  return keywords.filter((keyword) => lower.includes(keyword));
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
  const lower = text.toLowerCase();

  for (const bucket of PRACTICAL_BUCKET_PRIORITY) {
    if (keywordHits(lower, BUCKET_KEYWORDS[bucket]).length > 0) {
      return bucket;
    }
  }

  return textIncludesAny(lower, SCOPE_KEYWORDS) ? "product_trend" : "ignore";
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
  scores: ReturnType<typeof scoreSnapshot>;
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
  const preferredKeywordHits = settings.preferredKeywords.filter((keyword) => text.toLowerCase().includes(keyword)).length;
  const impactScore = Math.max(
    1,
    Math.min(
      10,
      2 + IMPORTANT_KEYWORDS.filter((keyword) => text.toLowerCase().includes(keyword)).length + preferredKeywordHits,
    ),
  );
  const confirmationScore = Math.min(10, snapshot.duplicate_count >= 5 ? 10 : snapshot.duplicate_count * 3);
  const scopeFitScore = textIncludesAny(text, [...SCOPE_KEYWORDS, ...settings.preferredKeywords]) ? 9 : 4;
  const actionabilityScore = actionabilityScoreForText(text);
  const publishedTimestamp = Date.parse(publishedAt);
  const ageHours = Number.isNaN(publishedTimestamp) ? 72 : (Date.now() - publishedTimestamp) / 3_600_000;
  const urgencyScore = ageHours <= 6 ? 10 : ageHours <= 24 ? 8 : ageHours <= 72 ? 5 : 3;
  const noveltyScore = 8;
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
    confirmationScore,
    editorialScore,
    impactScore,
    noveltyScore,
    scopeFitScore,
    urgencyScore,
  };
}

export const runEditorialScoringStage: StageRunner = async ({ digestRunId }) => {
  const [settings, snapshots, startedByUserId] = await Promise.all([
    getDigestSettingsForRun(digestRunId),
    loadRunSnapshots(digestRunId),
    loadRunStartedByUserId(digestRunId),
  ]);
  const feedbackProfile = await getFeedbackProfileForUser(startedByUserId);
  const scored = snapshots
    .map((snapshot) => {
      const scores = scoreSnapshot(snapshot, settings);
      const title = jsonString(snapshot.metadata, "title");
      const summary = jsonString(snapshot.metadata, "summary");
      const category = jsonString(snapshot.metadata, "category");
      const publishedAt = jsonString(snapshot.metadata, "publishedAt");
      const source = jsonString(snapshot.metadata, "source");
      const feed = readerFeedForCategory(category);
      const text = `${title} ${summary} ${category}`;
      const isMajorSecurity = feed === "security" ? securityStoryIsMajor(snapshot, text) : false;
      const isDeveloperSecurity = feed === "security" ? securityStoryIsDeveloperRelevant(text) : false;
      const geopoliticsIsRelevant =
        feed === "geopolitics" ? geopoliticsStoryAffectsBusinessSecurityChipsEnergy(text) : false;
      const excludedKeywordPenalty = textIncludesAny(text, settings.excludedKeywords) ? 80 : 0;
      const feedbackAdjustment = feedbackScoreAdjustment(feedbackProfile, { category, source, text });
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

      return {
        dedupeProfile,
        feedbackAdjustment,
        feed,
        feedAdjustment,
        geopoliticsIsRelevant,
        isDeveloperSecurity,
        isMajorSecurity,
        practicalBucket,
        scores,
        selectionScore: scores.editorialScore + feedAdjustment + feedbackAdjustment - excludedKeywordPenalty,
        snapshot,
      };
    })
    .sort((left, right) => right.selectionScore - left.selectionScore);
  const candidates = scored.filter((item) => {
    if (item.scores.editorialScore < settings.minimumImportanceScore) {
      return false;
    }

    return (
      item.feed !== "security" ||
      !settings.requireMajorSecurity ||
      item.isMajorSecurity ||
      item.isDeveloperSecurity
    );
  });
  const selectedIds = new Set<string>();
  const selectedItems: typeof scored = [];
  const suppressedDuplicates = new Map<string, { duplicateOfSnapshotId: string; reason: string; score: number }>();
  const selectedCounts: Record<ContentFeed, number> = {
    geopolitics: 0,
    business: 0,
    ai: 0,
    software: 0,
    security: 0,
  };

  function selectItem(item: (typeof scored)[number]) {
    if (selectedIds.size >= settings.publishTopN || selectedIds.has(item.snapshot.id)) {
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
        return;
      }
    }

    selectedIds.add(item.snapshot.id);
    selectedItems.push(item);
    selectedCounts[item.feed] += 1;
  }

  for (const feed of FEED_SELECTION_ORDER) {
    const feedCandidates = candidates.filter((item) => item.feed === feed);

    for (const item of feedCandidates) {
      if (selectedCounts[feed] >= settings.feedTargets[feed]) {
        break;
      }

      selectItem(item);
    }
  }

  for (const item of candidates) {
    if (item.feed === "security" && selectedCounts.security >= settings.feedTargets.security) {
      continue;
    }

    selectItem(item);
  }

  const supabase = createSupabaseAdminClient();
  const scoredSnapshots: StorySnapshotInsert[] = scored.map(
    ({
      dedupeProfile: _dedupeProfile,
      feedbackAdjustment,
      feed,
      feedAdjustment,
      geopoliticsIsRelevant,
      isDeveloperSecurity,
      isMajorSecurity,
      practicalBucket,
      scores,
      selectionScore,
      snapshot,
    }) => {
      const duplicateSuppression = suppressedDuplicates.get(snapshot.id);

      return {
        ...snapshot,
        confirmation_score: scores.confirmationScore,
        editorial_score: scores.editorialScore,
        impact_score: scores.impactScore,
        is_selected: selectedIds.has(snapshot.id),
        metadata: {
          ...jsonRecord(snapshot.metadata),
          ...(duplicateSuppression ? { duplicateSuppression } : {}),
          isDeveloperSecurity,
          isMajorSecurity,
          practicalBucket,
          recommendedAction: recommendedActionForBucket(practicalBucket),
          scoreComponents: {
            actionability: scores.actionabilityScore,
            confirmation: scores.confirmationScore,
            editorial: scores.editorialScore,
            feedbackAdjustment,
            feed,
            feedAdjustment,
            geopoliticsIsRelevant,
            impact: scores.impactScore,
            novelty: scores.noveltyScore,
            scopeFit: scores.scopeFitScore,
            selection: selectionScore,
            sourcePriority: Math.max(0, Math.min(5, jsonNumber(snapshot.metadata, "sourcePriority"))),
            urgency: scores.urgencyScore,
          },
          whyInteresting: selectionReasonForStory({
            bucket: practicalBucket,
            feed,
            feedbackAdjustment,
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

  return {
    metrics: {
      selectedCount: selectedIds.size,
      selectedFeedCounts: selectedCounts,
      suppressedDuplicateCount: suppressedDuplicates.size,
      settings: {
        minimumImportanceScore: settings.minimumImportanceScore,
        publishTopN: settings.publishTopN,
        requireMajorSecurity: settings.requireMajorSecurity,
      },
      feedbackAdjustedCount: scored.filter((item) => item.feedbackAdjustment !== 0).length,
      skippedNonMajorSecurityCount: settings.requireMajorSecurity
        ? scored.filter((item) => item.feed === "security" && !item.isMajorSecurity && !item.isDeveloperSecurity).length
        : 0,
      storyCount: snapshots.length,
    },
  };
};
