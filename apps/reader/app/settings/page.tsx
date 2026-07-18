import { ArrowLeft, Plus, Save } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedTargetSliders } from "@/components/feed-target-sliders";
import { Input } from "@/components/ui/input";
import { KeywordGroupManager } from "@/components/keyword-group-manager";
import { Label } from "@/components/ui/label";
import { SourceEnabledToggle } from "@/components/source-enabled-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  applyPortfolioSuggestion,
  confirmSourceDiscovery,
  dismissPortfolioSuggestion,
  resetPersonalization,
  saveReaderDigestSettings,
  saveReaderSource,
  saveReaderSourcePreset,
  saveReaderSources,
  startSourceDiscovery,
  updateReaderSourceMode,
} from "@/lib/actions";
import { hasNvidiaSummaryConfig } from "@/lib/ai-summary";
import { requireCurrentReader } from "@/lib/auth";
import {
  getReaderDigestSettings,
  type ReaderDigestSettings,
} from "@/lib/digest-settings";
import { READER_FEEDS, normalizeReaderFeedId, readerFeedForCategory, type ReaderFeedId } from "@/lib/feed-categories";
import { getReaderFeedInsights } from "@/lib/feed-events";
import { getFeedbackProfileForUser, summarizeFeedbackProfile } from "@/lib/reader-feedback";
import { getRecommendationPolicyGate } from "@/lib/recommendation-policy-server";
import { getReaderSources, SOURCE_PRESETS, type ReaderSource } from "@/lib/reader-sources";
import { getSourceQualityInsights, type SourceQualityInsight } from "@/lib/source-quality";
import { getSourceAutopilotGate, getSourcePortfolioSuggestions } from "@/lib/source-portfolio";
import { discoverReaderSource } from "@/lib/source-discovery";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
  "migration-required": "Settings cannot be saved until the reader_digest_settings Supabase migration is applied.",
  "personalization-reset": "Learned preferences and interaction signals were reset.",
  "policy-gate-pending": "Recommendation Policy v2 remains in shadow mode until all ten-run activation criteria pass.",
  "save-failed": "Settings could not be saved. Check the server log for the database error.",
  saved: "Settings saved.",
  "source-invalid": "Source could not be saved. Check the URL, name, category, and priority.",
  "source-discovered": "Discovered source saved in Auto mode. It will be evaluated as a probe before normal selection.",
  "source-discovery-failed": "The source changed, already exists, or failed safety validation during confirmation.",
  "source-discovery-invalid": "Enter a valid HTTP or HTTPS website, article, RSS, or Atom URL.",
  "source-preset-saved": "Source preset applied.",
  "source-save-failed": "Source could not be saved. Check the server log for the database error.",
  "source-saved": "Source saved.",
  "sources-saved": "Sources saved.",
} as const;

const SUCCESS_STATUSES = new Set(["saved", "personalization-reset", "source-discovered", "source-preset-saved", "source-saved", "sources-saved"]);
const PRESET_CARD_CLASS =
  "h-auto min-h-20 w-full flex-col items-start gap-1 whitespace-normal px-3 py-2 text-left";
const SECTION_CARD_CLASS = "border-border/70 bg-card/70 shadow-sm ring-0";
const SECTION_HEADER_CLASS = "border-b border-border/60";
const SECTION_CONTENT_CLASS = "pt-1";

const DIGEST_PRESETS = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Broad daily mix.",
    feedTargets: { geopolitics: 14, business: 6, ai: 4, software: 4, security: 2 },
    publishTopN: 30,
  },
  {
    id: "brief",
    label: "Brief",
    description: "Small digest, less noise.",
    feedTargets: { geopolitics: 8, business: 4, ai: 3, software: 3, security: 2 },
    publishTopN: 20,
  },
  {
    id: "markets",
    label: "Markets",
    description: "Business and geopolitics first.",
    feedTargets: { geopolitics: 14, business: 12, ai: 1, software: 1, security: 2 },
    publishTopN: 30,
  },
  {
    id: "ai-tech",
    label: "AI + tech",
    description: "Labs, software, and security.",
    feedTargets: { geopolitics: 6, business: 3, ai: 8, software: 8, security: 5 },
    publishTopN: 30,
  },
  {
    id: "security",
    label: "Security",
    description: "Threats and incidents.",
    feedTargets: { geopolitics: 4, business: 2, ai: 2, software: 6, security: 16 },
    publishTopN: 30,
  },
] as const;

const KEYWORD_GROUPS = {
  avoid: [
    {
      id: "celebrity",
      label: "Celebrity noise",
      description: "Entertainment and personality-driven stories.",
      keywords: ["celebrity", "influencer", "royal family", "red carpet", "box office", "gossip"],
    },
    {
      id: "sports",
      label: "Sports",
      description: "Scores, teams, athletes, and leagues.",
      keywords: ["sports", "football", "soccer", "nba", "nfl", "tennis", "olympics"],
    },
    {
      id: "crypto-price",
      label: "Crypto price chatter",
      description: "Token-price and market-hype coverage.",
      keywords: ["bitcoin price", "crypto rally", "memecoin", "token", "airdrop", "nft"],
    },
    {
      id: "soft-launches",
      label: "Minor launches",
      description: "Low-signal product announcements.",
      keywords: ["launches", "teases", "rumor", "leak", "unboxing", "preview"],
    },
  ],
  prefer: [
    {
      id: "ai-infra",
      label: "AI infrastructure",
      description: "Chips, data centers, models, and AI platforms.",
      keywords: ["ai", "nvidia", "gpu", "semiconductor", "data center", "model", "inference"],
    },
    {
      id: "markets-policy",
      label: "Markets + policy",
      description: "Rates, central banks, energy, and regulators.",
      keywords: ["markets", "inflation", "central bank", "fed", "ecb", "energy", "regulation"],
    },
    {
      id: "security-incidents",
      label: "Security incidents",
      description: "Breaches, vulnerabilities, ransomware, and advisories.",
      keywords: ["security", "breach", "ransomware", "vulnerability", "cve", "exploit", "incident"],
    },
    {
      id: "engineering",
      label: "Engineering",
      description: "Developer tooling, cloud, open source, and platforms.",
      keywords: ["software", "developer", "open source", "cloud", "kubernetes", "database", "api"],
    },
    {
      id: "geopolitics",
      label: "Geopolitics",
      description: "Conflict, trade, sanctions, and international institutions.",
      keywords: ["china", "russia", "ukraine", "trade", "sanctions", "nato", "election"],
    },
  ],
} as const;

type DigestPresetId = (typeof DIGEST_PRESETS)[number]["id"];
type KeywordGroupKind = keyof typeof KEYWORD_GROUPS;
type KeywordGroupId = (typeof KEYWORD_GROUPS)[KeywordGroupKind][number]["id"];
type ActiveKeywordGroups = Record<KeywordGroupKind, KeywordGroupId[]>;
type SourceGroup = {
  enabledCount: number;
  id: Exclude<ReaderFeedId, "all">;
  label: string;
  sources: ReaderSource[];
};
type SourceFeedId = Exclude<ReaderFeedId, "all">;
type SourceFeed = {
  id: SourceFeedId;
  label: string;
};
type SettingsTabId = "general" | "advanced" | "sources";

type SettingsPageProps = {
  searchParams?: Promise<{
    avoidKeywordGroup?: string | string[];
    discoveryUrl?: string | string[];
    preset?: string | string[];
    preferKeywordGroup?: string | string[];
    settingsTab?: string | string[];
    sourceFeed?: string | string[];
    status?: string | string[];
  }>;
};

const DIGEST_PRESET_IDS = new Set<DigestPresetId>(DIGEST_PRESETS.map((preset) => preset.id));
const KEYWORD_GROUP_IDS = {
  avoid: new Set(KEYWORD_GROUPS.avoid.map((group) => group.id)),
  prefer: new Set(KEYWORD_GROUPS.prefer.map((group) => group.id)),
} satisfies Record<KeywordGroupKind, Set<string>>;
const SOURCE_FEEDS = READER_FEEDS.filter((feed) => feed.id !== "all") as readonly SourceFeed[];
const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "advanced", label: "Advanced" },
  { id: "sources", label: "Sources" },
] as const;
const SETTINGS_TAB_IDS = new Set<SettingsTabId>(SETTINGS_TABS.map((tab) => tab.id));

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function allSearchValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function isSuccessStatus(status: string | undefined) {
  return status ? SUCCESS_STATUSES.has(status) : false;
}

function normalizeDigestPresetId(value: string | string[] | undefined): DigestPresetId | null {
  const presetId = firstSearchValue(value);

  return presetId && DIGEST_PRESET_IDS.has(presetId as DigestPresetId) ? (presetId as DigestPresetId) : null;
}

function normalizeSettingsTabId(value: string | string[] | undefined): SettingsTabId {
  const tabId = firstSearchValue(value);

  return tabId && SETTINGS_TAB_IDS.has(tabId as SettingsTabId) ? (tabId as SettingsTabId) : "general";
}

function normalizeSettingsSourceFeed(value: string | string[] | undefined): SourceFeedId {
  const feedId = normalizeReaderFeedId(value);

  return feedId === "all" ? "geopolitics" : feedId;
}

function settingsHref({
  avoidKeywordGroups = [],
  preset,
  preferKeywordGroups = [],
  sourceFeed,
  settingsTab,
}: {
  avoidKeywordGroups?: readonly KeywordGroupId[];
  preset?: DigestPresetId | null;
  preferKeywordGroups?: readonly KeywordGroupId[];
  settingsTab?: SettingsTabId;
  sourceFeed?: ReaderFeedId;
}) {
  const params = new URLSearchParams();

  if (settingsTab && settingsTab !== "general") {
    params.set("settingsTab", settingsTab);
  }

  if (preset) {
    params.set("preset", preset);
  }

  if (sourceFeed && sourceFeed !== "all") {
    params.set("sourceFeed", sourceFeed);
  }

  for (const groupId of preferKeywordGroups) {
    params.append("preferKeywordGroup", groupId);
  }

  for (const groupId of avoidKeywordGroups) {
    params.append("avoidKeywordGroup", groupId);
  }

  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
}

function applyDigestPreset(settings: ReaderDigestSettings, presetId: DigestPresetId | null): ReaderDigestSettings {
  const preset = DIGEST_PRESETS.find((candidate) => candidate.id === presetId);

  if (!preset) {
    return settings;
  }

  return {
    ...settings,
    feedTargets: preset.feedTargets,
    publishTopN: preset.publishTopN,
  };
}

function normalizeKeywordGroupIds(kind: KeywordGroupKind, value: string | string[] | undefined): KeywordGroupId[] {
  const seen = new Set<KeywordGroupId>();
  const validIds: ReadonlySet<string> = KEYWORD_GROUP_IDS[kind];

  for (const groupId of allSearchValues(value)) {
    if (validIds.has(groupId)) {
      seen.add(groupId as KeywordGroupId);
    }
  }

  return [...seen];
}

function activeKeywordGroupsFromSettings(kind: KeywordGroupKind, keywords: readonly string[]): KeywordGroupId[] {
  const keywordSet = new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean));

  return KEYWORD_GROUPS[kind]
    .filter((group) => group.keywords.some((keyword) => keywordSet.has(keyword)))
    .map((group) => group.id);
}

function keywordsFromActiveGroups(kind: KeywordGroupKind, groupIds: readonly KeywordGroupId[]) {
  const activeGroupIds = new Set(groupIds);
  const seen = new Set<string>();

  return KEYWORD_GROUPS[kind]
    .filter((group) => activeGroupIds.has(group.id))
    .flatMap((group) => group.keywords)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => {
      if (!keyword || seen.has(keyword)) {
        return false;
      }

      seen.add(keyword);
      return true;
    });
}

function groupedSources(sources: ReaderSource[]): SourceGroup[] {
  const groups = new Map<Exclude<ReaderFeedId, "all">, ReaderSource[]>();

  for (const feed of READER_FEEDS) {
    if (feed.id !== "all") {
      groups.set(feed.id, []);
    }
  }

  for (const source of sources) {
    groups.get(readerFeedForCategory(source.category))?.push(source);
  }

  return READER_FEEDS.filter((feed) => feed.id !== "all").map((feed) => {
    const groupSources = groups.get(feed.id) ?? [];

    return {
      ...feed,
      enabledCount: groupSources.filter((source) => source.enabled).length,
      sources: groupSources,
    };
  });
}

function visibleSourceGroups(groups: SourceGroup[], activeFeed: ReaderFeedId) {
  return activeFeed === "all" ? groups : groups.filter((group) => group.id === activeFeed);
}

function sourceTabCount(groups: SourceGroup[], feedId: ReaderFeedId) {
  if (feedId === "all") {
    return groups.reduce(
      (total, group) => ({
        enabled: total.enabled + group.enabledCount,
        sources: total.sources + group.sources.length,
      }),
      { enabled: 0, sources: 0 },
    );
  }

  const group = groups.find((candidate) => candidate.id === feedId);
  return { enabled: group?.enabledCount ?? 0, sources: group?.sources.length ?? 0 };
}

function NumberField({
  defaultValue,
  id,
  label,
  max,
  min,
  name,
}: {
  defaultValue: number;
  id?: string;
  label: string;
  max: number;
  min: number;
  name: string;
}) {
  const inputId = id ?? name;

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input id={inputId} name={name} type="number" min={min} max={max} defaultValue={defaultValue} />
    </div>
  );
}

function HiddenDigestAdvancedFields({ settings }: { settings: ReaderDigestSettings }) {
  return (
    <>
      <input type="hidden" name="freshnessWindowHours" value={settings.freshnessWindowHours} />
      <input type="hidden" name="minimumSourceCount" value={settings.minimumSourceCount} />
      <input type="hidden" name="maxStoriesPerSource" value={settings.maxStoriesPerSource} />
      <input type="hidden" name="readableOnly" value={settings.readableOnly ? "on" : "off"} />
      <input type="hidden" name="personalizationEnabled" value={settings.personalizationEnabled ? "on" : "off"} />
      <input type="hidden" name="implicitPersonalizationEnabled" value={settings.implicitPersonalizationEnabled ? "on" : "off"} />
      <input type="hidden" name="recommendationPolicyMode" value={settings.recommendationPolicyMode} />
      <input type="hidden" name="summaryMaxChars" value={settings.summaryMaxChars} />
      <input type="hidden" name="useAiSummaries" value={settings.useAiSummaries ? "on" : "off"} />
      <input type="hidden" name="sourcePortfolioMode" value={settings.sourcePortfolioMode} />
      <input type="hidden" name="sourceBudget" value={settings.sourceBudget} />
      <input type="hidden" name="sourceProbeCount" value={settings.sourceProbeCount} />
      <input type="hidden" name="sourceMinimumGeopolitics" value={settings.sourceCategoryMinimums.geopolitics} />
      <input type="hidden" name="sourceMinimumBusiness" value={settings.sourceCategoryMinimums.business} />
      <input type="hidden" name="sourceMinimumAi" value={settings.sourceCategoryMinimums.ai} />
      <input type="hidden" name="sourceMinimumSoftware" value={settings.sourceCategoryMinimums.software} />
      <input type="hidden" name="sourceMinimumSecurity" value={settings.sourceCategoryMinimums.security} />
    </>
  );
}

function HiddenDigestGeneralFields({
  activeKeywordGroups,
  settings,
}: {
  activeKeywordGroups: ActiveKeywordGroups;
  settings: ReaderDigestSettings;
}) {
  return (
    <>
      <input type="hidden" name="publishTopN" value={settings.publishTopN} />
      <input type="hidden" name="minimumImportanceScore" value={settings.minimumImportanceScore} />
      <input type="hidden" name="requireMajorSecurity" value={settings.requireMajorSecurity ? "on" : "off"} />
      <input type="hidden" name="feedTargetGeopolitics" value={settings.feedTargets.geopolitics} />
      <input type="hidden" name="feedTargetBusiness" value={settings.feedTargets.business} />
      <input type="hidden" name="feedTargetAi" value={settings.feedTargets.ai} />
      <input type="hidden" name="feedTargetSoftware" value={settings.feedTargets.software} />
      <input type="hidden" name="feedTargetSecurity" value={settings.feedTargets.security} />
      <input type="hidden" name="preferredKeywords" value={keywordsFromActiveGroups("prefer", activeKeywordGroups.prefer).join(", ")} />
      <input type="hidden" name="excludedKeywords" value={keywordsFromActiveGroups("avoid", activeKeywordGroups.avoid).join(", ")} />
    </>
  );
}

function sourceFieldName(fieldName: string, fieldNamePrefix?: string) {
  return fieldNamePrefix ? `${fieldNamePrefix}.${fieldName}` : fieldName;
}

function SourceFields({
  fieldNamePrefix,
  showEnabled = true,
  source,
}: {
  fieldNamePrefix?: string;
  showEnabled?: boolean;
  source?: ReaderSource;
}) {
  const sourceFieldId = source?.id ?? "new";

  return (
    <>
      {source ? <input type="hidden" name={sourceFieldName("id", fieldNamePrefix)} value={source.id} /> : null}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={`source-name-${sourceFieldId}`}>Name</Label>
          <Input
            id={`source-name-${sourceFieldId}`}
            name={sourceFieldName("name", fieldNamePrefix)}
            defaultValue={source?.name}
            required
            maxLength={200}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={`source-url-${sourceFieldId}`}>Feed URL</Label>
          <Input
            id={`source-url-${sourceFieldId}`}
            name={sourceFieldName("url", fieldNamePrefix)}
            type="url"
            defaultValue={source?.url}
            required
            maxLength={2000}
          />
        </div>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_7rem_10rem_auto] lg:items-end">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={`source-category-${sourceFieldId}`}>Category</Label>
          <Input
            id={`source-category-${sourceFieldId}`}
            name={sourceFieldName("category", fieldNamePrefix)}
            defaultValue={source?.category}
            required
            maxLength={200}
          />
        </div>
        <NumberField
          id={`source-priority-${sourceFieldId}`}
          name={sourceFieldName("priority", fieldNamePrefix)}
          label="Priority"
          min={1}
          max={5}
          defaultValue={source?.priority ?? 3}
        />
        <div className="grid gap-2">
          <Label htmlFor={`source-mode-${sourceFieldId}`}>Portfolio mode</Label>
          <select
            id={`source-mode-${sourceFieldId}`}
            name={sourceFieldName("selectionMode", fieldNamePrefix)}
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs"
            defaultValue={source?.selectionMode ?? "auto"}
          >
            <option value="always_on">Always on</option>
            <option value="auto">Auto</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        {showEnabled ? (
          <label className="flex h-8 items-center gap-2 text-sm font-medium">
            <input
              className="size-4 accent-primary"
              type="checkbox"
              name={sourceFieldName("enabled", fieldNamePrefix)}
              defaultChecked={source?.enabled ?? true}
            />
            Enabled
          </label>
        ) : null}
      </div>
    </>
  );
}

function DigestPresetLinks({
  activePreset,
  activeKeywordGroups,
  activeSourceFeed,
}: {
  activePreset: DigestPresetId | null;
  activeKeywordGroups: ActiveKeywordGroups;
  activeSourceFeed: ReaderFeedId;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {DIGEST_PRESETS.map((preset) => {
        const active = preset.id === activePreset;

        return (
          <Link
            key={preset.id}
            className={cn(
              buttonVariants({ variant: active ? "default" : "outline" }),
              PRESET_CARD_CLASS,
            )}
            href={settingsHref({
              avoidKeywordGroups: activeKeywordGroups.avoid,
              preferKeywordGroups: activeKeywordGroups.prefer,
              preset: preset.id,
              sourceFeed: activeSourceFeed,
            })}
            scroll={false}
          >
            <span className="font-semibold">{preset.label}</span>
            <span className={cn("text-xs font-normal", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {preset.description}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function SourcePresetControls({ activeSourceFeed }: { activeSourceFeed: SourceFeedId }) {
  return (
    <form action={saveReaderSourcePreset} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
      <input type="hidden" name="settingsTab" value="sources" />
      <div className="grid gap-2">
        <Label htmlFor="sourcePreset">Preset</Label>
        <select
          id="sourcePreset"
          name="sourcePreset"
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          defaultValue="essentials"
        >
          {SOURCE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline">Apply preset</Button>
    </form>
  );
}

function SourceTabs({
  activeFeed,
  activeKeywordGroups,
  activePreset,
  groups,
}: {
  activeFeed: SourceFeedId;
  activeKeywordGroups: ActiveKeywordGroups;
  activePreset: DigestPresetId | null;
  groups: SourceGroup[];
}) {
  const sharedHrefParams = {
    avoidKeywordGroups: activeKeywordGroups.avoid,
    preferKeywordGroups: activeKeywordGroups.prefer,
    preset: activePreset,
    settingsTab: "sources" as const,
  };

  return (
    <nav className="grid grid-cols-2 gap-2 lg:grid-cols-5" aria-label="Source categories">
      {SOURCE_FEEDS.map((feed) => {
        const active = feed.id === activeFeed;
        const count = sourceTabCount(groups, feed.id);

        return (
          <Link
            key={feed.id}
            className={cn(
              "grid min-h-16 content-center gap-1 rounded-xl border px-3 py-2 text-left transition-colors",
              active
                ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                : "bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            href={settingsHref({ ...sharedHrefParams, sourceFeed: feed.id })}
            scroll={false}
            aria-current={active ? "page" : undefined}
          >
            <span className="truncate text-sm font-semibold">{feed.label}</span>
            <span className="text-xs tabular-nums">{count.enabled} of {count.sources} active</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SettingsTabs({
  activeKeywordGroups,
  activePreset,
  activeSourceFeed,
  activeTab,
}: {
  activeKeywordGroups: ActiveKeywordGroups;
  activePreset: DigestPresetId | null;
  activeSourceFeed: SourceFeedId;
  activeTab: SettingsTabId;
}) {
  return (
    <nav className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/30 p-1" aria-label="Settings sections">
      {SETTINGS_TABS.map((tab) => {
        const active = tab.id === activeTab;

        return (
          <Link
            key={tab.id}
            className={cn(
              "inline-flex h-10 min-w-0 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
            )}
            href={settingsHref({
              avoidKeywordGroups: activeKeywordGroups.avoid,
              preferKeywordGroups: activeKeywordGroups.prefer,
              preset: activePreset,
              settingsTab: tab.id,
              sourceFeed: activeSourceFeed,
            })}
            scroll={false}
          >
            <span className="truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SourceEditor({
  fieldNamePrefix,
  quality,
  source,
}: {
  fieldNamePrefix: string;
  quality?: SourceQualityInsight;
  source: ReaderSource;
}) {
  return (
    <details className="group min-w-0 rounded-xl border bg-background/70 transition-colors open:bg-background">
      <summary className="grid min-w-0 cursor-pointer list-none grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{source.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{source.category}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {quality ? <Badge variant={quality.recommendation === "keep" ? "secondary" : "outline"}>{quality.label}</Badge> : null}
          <Badge variant={source.validationStatus === "valid" ? "secondary" : "outline"}>{source.validationStatus}</Badge>
          <Badge variant="outline">{source.selectionMode.replace("_", " ")}</Badge>
          <SourceEnabledToggle defaultEnabled={source.enabled} name={sourceFieldName("enabled", fieldNamePrefix)} />
          <Badge variant="outline" className="hidden sm:inline-flex">Priority {source.priority}</Badge>
          <span className="ml-auto text-right text-xs font-medium text-muted-foreground group-open:hidden sm:ml-0 sm:w-12">Edit</span>
          <span className="ml-auto hidden text-right text-xs font-medium text-muted-foreground group-open:inline sm:ml-0 sm:w-12">Close</span>
        </div>
      </summary>
      <div className="grid min-w-0 gap-3 border-t p-3">
        <p className="truncate text-xs text-muted-foreground">{source.url}</p>
        {quality ? (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            {[
              ["Reliability", quality.reliability],
              ["Fresh yield", quality.freshYield],
              ["Unique yield", quality.uniqueYield],
              ["Selected", quality.selectionValue],
              ["Reader value", quality.readerValue],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border bg-muted/20 p-2">
                <p className="text-muted-foreground">{label}</p>
                <p className="mt-1 font-semibold tabular-nums">{value}%</p>
              </div>
            ))}
          </div>
        ) : null}
        <SourceFields fieldNamePrefix={fieldNamePrefix} showEnabled={false} source={source} />
      </div>
    </details>
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireCurrentReader();
  const rawSearchParams = await searchParams;
  const activeSettingsTab = normalizeSettingsTabId(rawSearchParams?.settingsTab);
  const activeSourceFeed = normalizeSettingsSourceFeed(rawSearchParams?.sourceFeed);
  const activePreset = normalizeDigestPresetId(rawSearchParams?.preset);
  const discoveryUrl = firstSearchValue(rawSearchParams?.discoveryUrl)?.slice(0, 2_000) || "";
  const queryKeywordGroups: ActiveKeywordGroups = {
    avoid: normalizeKeywordGroupIds("avoid", rawSearchParams?.avoidKeywordGroup),
    prefer: normalizeKeywordGroupIds("prefer", rawSearchParams?.preferKeywordGroup),
  };
  const [savedSettings, sources, insights, sourceQuality, sourceSuggestions, autopilotGate, recommendationGate, discoveryResult] = await Promise.all([
    getReaderDigestSettings(user.id),
    getReaderSources(),
    getReaderFeedInsights(user.id),
    getSourceQualityInsights(user.id),
    getSourcePortfolioSuggestions().catch(() => []),
    getSourceAutopilotGate().catch(() => ({ automaticRunCount: 0, criteria: null, passed: false })),
    getRecommendationPolicyGate().catch(() => ({
      deterministicTieBreaks: false,
      eligibilityViolationCount: 0,
      explanationCoverage: 0,
      feedParity: false,
      pairedRunCount: 0,
      passed: false,
      reasons: ["Recommendation decision migration or shadow evidence is not available"],
      top20Overlap: 0,
    })),
    discoveryUrl
      ? discoverReaderSource(discoveryUrl)
          .then((proposal) => ({ error: null, proposal }))
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : "Source discovery failed.",
            proposal: null,
          }))
      : Promise.resolve({ error: null, proposal: null }),
  ]);
  const learnedPreferences = summarizeFeedbackProfile(
    await getFeedbackProfileForUser(user.id, {
      includeImplicit: savedSettings.implicitPersonalizationEnabled,
    }),
  );
  const settings = applyDigestPreset(savedSettings, activePreset);
  const activeKeywordGroups: ActiveKeywordGroups = {
    avoid: allSearchValues(rawSearchParams?.avoidKeywordGroup).length
      ? queryKeywordGroups.avoid
      : activeKeywordGroupsFromSettings("avoid", settings.excludedKeywords),
    prefer: allSearchValues(rawSearchParams?.preferKeywordGroup).length
      ? queryKeywordGroups.prefer
      : activeKeywordGroupsFromSettings("prefer", settings.preferredKeywords),
  };
  const sourceGroups = groupedSources(sources);
  const shownSourceGroups = visibleSourceGroups(sourceGroups, activeSourceFeed);
  const shownSourceCount = shownSourceGroups.reduce((total, group) => total + group.sources.length, 0);
  const sourceCounts = sourceTabCount(sourceGroups, "all");
  const hasNvidiaKey = hasNvidiaSummaryConfig();
  const rawStatus = firstSearchValue(rawSearchParams?.status);
  const statusCopy = rawStatus && rawStatus in STATUS_COPY ? STATUS_COPY[rawStatus as keyof typeof STATUS_COPY] : null;
  let sourceFieldIndex = 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-center justify-between gap-4">
        <Link
          className={buttonVariants({ variant: "outline", size: "icon-lg" })}
          href="/"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div className="min-w-0 text-right">
          <h1 className="text-xl font-semibold leading-tight tracking-normal sm:text-2xl">Digest settings</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </header>

      {statusCopy ? (
        <Alert variant={isSuccessStatus(rawStatus) ? "default" : "destructive"}>
          <AlertDescription>{statusCopy}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsTabs
        activeKeywordGroups={activeKeywordGroups}
        activePreset={activePreset}
        activeSourceFeed={activeSourceFeed}
        activeTab={activeSettingsTab}
      />

      {activeSettingsTab === "general" ? (
        <div className="grid gap-4">
          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Theme applies across the reader.</CardDescription>
            </CardHeader>
            <CardContent className={SECTION_CONTENT_CLASS}>
              <ThemeToggle />
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <CardTitle>Feed insights</CardTitle>
              <CardDescription>Private engagement signals from the last 180 days.</CardDescription>
            </CardHeader>
            <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-3")}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {[
                  ["Impressions", String(insights.impressions)],
                  ["Open rate", `${Math.round(insights.openRate * 100)}%`],
                  ["Save rate", `${Math.round(insights.saveRate * 100)}%`],
                  ["Feedback rate", `${Math.round(insights.feedbackRate * 100)}%`],
                  ["Unread after 24h", String(insights.unreadAfter24Hours)],
                  ["Legacy events", String(insights.legacyEventCount)],
                  ["Unattributed outcomes", String(insights.unattributedOutcomeCount)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              {insights.ignoredTopics.length || insights.ignoredSources.length ? (
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><p className="font-medium">Often reduced topics</p><p className="text-muted-foreground">{insights.ignoredTopics.map((item) => `${item.label} (${item.value})`).join(", ") || "None yet"}</p></div>
                  <div><p className="font-medium">Often reduced sources</p><p className="text-muted-foreground">{insights.ignoredSources.map((item) => `${item.label} (${item.value})`).join(", ") || "None yet"}</p></div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <form
            key={`digest-general-${activePreset ?? "saved"}-${activeKeywordGroups.prefer.join(".")}-${activeKeywordGroups.avoid.join(".")}`}
            action={saveReaderDigestSettings}
            className="grid gap-4"
          >
            <input type="hidden" name="settingsTab" value="general" />
            <HiddenDigestAdvancedFields settings={settings} />

            <Card className={SECTION_CARD_CLASS}>
              <CardHeader className={SECTION_HEADER_CLASS}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Digest presets</CardTitle>
                    <CardDescription>Start with a balanced mix or bias the digest toward a topic.</CardDescription>
                  </div>
                  {activePreset ? <Badge variant="secondary">preset pending</Badge> : null}
                </div>
              </CardHeader>
              <CardContent className={SECTION_CONTENT_CLASS}>
                <DigestPresetLinks
                  activeKeywordGroups={activeKeywordGroups}
                  activePreset={activePreset}
                  activeSourceFeed={activeSourceFeed}
                />
              </CardContent>
            </Card>

            <Card className={SECTION_CARD_CLASS}>
              <CardHeader className={SECTION_HEADER_CLASS}>
                <CardTitle>Output limits</CardTitle>
                <CardDescription>Control digest size and the minimum score needed to publish an item.</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField name="publishTopN" label="Articles per digest" min={5} max={100} defaultValue={settings.publishTopN} />
                  <NumberField
                    name="minimumImportanceScore"
                    label="Minimum score"
                    min={0}
                    max={100}
                    defaultValue={settings.minimumImportanceScore}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    className="size-4 accent-primary"
                    type="checkbox"
                    name="requireMajorSecurity"
                    defaultChecked={settings.requireMajorSecurity}
                  />
                  Major security only
                </label>
              </CardContent>
            </Card>

            <Card className={SECTION_CARD_CLASS}>
              <CardHeader className={SECTION_HEADER_CLASS}>
                <CardTitle>Category targets</CardTitle>
                <CardDescription>Set how many stories each feed contributes before final ranking.</CardDescription>
              </CardHeader>
              <CardContent className={SECTION_CONTENT_CLASS}>
                <FeedTargetSliders feedTargets={settings.feedTargets} />
              </CardContent>
            </Card>

            <Card className={SECTION_CARD_CLASS}>
              <CardHeader className={SECTION_HEADER_CLASS}>
                <CardTitle>Reading filters</CardTitle>
                <CardDescription>Choose topics to like or dislike.</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
                <KeywordGroupManager
                  activeAvoidGroupIds={activeKeywordGroups.avoid}
                  activePreferGroupIds={activeKeywordGroups.prefer}
                  avoidGroups={KEYWORD_GROUPS.avoid}
                  preferGroups={KEYWORD_GROUPS.prefer}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" size="lg">
                <Save aria-hidden="true" />
                Save settings
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {activeSettingsTab === "advanced" ? (
        <form action={saveReaderDigestSettings} className="grid gap-4">
          <input type="hidden" name="settingsTab" value="advanced" />
          <HiddenDigestGeneralFields activeKeywordGroups={activeKeywordGroups} settings={settings} />

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <CardTitle>Quality controls</CardTitle>
              <CardDescription>Trade breadth for fresher, better-confirmed, and more diverse stories.</CardDescription>
            </CardHeader>
            <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField
                  name="freshnessWindowHours"
                  label="Freshness window (hours)"
                  min={6}
                  max={336}
                  defaultValue={settings.freshnessWindowHours}
                />
                <NumberField
                  name="minimumSourceCount"
                  label="Minimum source matches"
                  min={1}
                  max={10}
                  defaultValue={settings.minimumSourceCount}
                />
                <NumberField
                  name="maxStoriesPerSource"
                  label="Stories per source"
                  min={1}
                  max={20}
                  defaultValue={settings.maxStoriesPerSource}
                />
              </div>
              <label className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
                <input
                  className="mt-0.5 size-4 accent-primary"
                  type="checkbox"
                  name="readableOnly"
                  defaultChecked={settings.readableOnly}
                />
                <span>
                  <span className="block font-medium">Written articles only</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    Reject audio-only, video-only, teaser, and empty pages. Articles with optional audio remain eligible when they contain full text.
                  </span>
                </span>
              </label>
              <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                A 48–72 hour window and one source match work well for speed. Raise source matches to 2 for a stricter,
                better-confirmed digest; the per-source limit prevents one publisher from dominating the result.
              </p>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Source Portfolio</CardTitle>
                <Badge variant={autopilotGate.passed ? "secondary" : "outline"}>
                  {autopilotGate.passed ? "10-run gate passed" : `${autopilotGate.automaticRunCount}/10 automatic runs`}
                </Badge>
              </div>
              <CardDescription>Keep source selection manual, inspect shadow suggestions, or opt into guarded automatic selection.</CardDescription>
            </CardHeader>
            <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="sourcePortfolioMode">Portfolio behavior</Label>
                  <select
                    id="sourcePortfolioMode"
                    name="sourcePortfolioMode"
                    className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs"
                    defaultValue={settings.sourcePortfolioMode}
                  >
                    <option value="manual">Manual</option>
                    <option value="advisory">Advisory (shadow)</option>
                    <option value="automatic">Automatic (opt-in)</option>
                  </select>
                </div>
                <NumberField name="sourceBudget" label="Source budget" min={5} max={200} defaultValue={settings.sourceBudget} />
                <NumberField name="sourceProbeCount" label="Probe slots" min={0} max={10} defaultValue={settings.sourceProbeCount} />
              </div>
              <div className="grid gap-3 sm:grid-cols-5">
                <NumberField name="sourceMinimumGeopolitics" label="Geopolitics min." min={0} max={50} defaultValue={settings.sourceCategoryMinimums.geopolitics} />
                <NumberField name="sourceMinimumBusiness" label="Business min." min={0} max={50} defaultValue={settings.sourceCategoryMinimums.business} />
                <NumberField name="sourceMinimumAi" label="AI min." min={0} max={50} defaultValue={settings.sourceCategoryMinimums.ai} />
                <NumberField name="sourceMinimumSoftware" label="Software min." min={0} max={50} defaultValue={settings.sourceCategoryMinimums.software} />
                <NumberField name="sourceMinimumSecurity" label="Security min." min={0} max={50} defaultValue={settings.sourceCategoryMinimums.security} />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Automatic mode changes at most 20% of the previous successful portfolio, preserves hard source modes and category minimums, and falls back safely if portfolio selection fails.
              </p>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Recommendation Policy</CardTitle>
                <Badge variant={recommendationGate.passed ? "secondary" : "outline"}>
                  {recommendationGate.passed ? "v2 activation gate passed" : `${recommendationGate.pairedRunCount}/10 paired runs`}
                </Badge>
              </div>
              <CardDescription>Run v2 beside v1, activate it after the evidence gate, or force the emergency v1 rollback.</CardDescription>
            </CardHeader>
            <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-3")}>
              <div className="grid gap-2">
                <Label htmlFor="recommendationPolicyMode">Production policy</Label>
                <select
                  id="recommendationPolicyMode"
                  name="recommendationPolicyMode"
                  className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs"
                  defaultValue={settings.recommendationPolicyMode}
                >
                  <option value="shadow">v1 production + v2 shadow</option>
                  <option value="v2" disabled={!recommendationGate.passed}>v2 production</option>
                  <option value="v1">Emergency v1 rollback</option>
                </select>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Top-20 overlap {(recommendationGate.top20Overlap * 100).toFixed(0)}% · explanation coverage {(recommendationGate.explanationCoverage * 100).toFixed(0)}% · eligibility violations {recommendationGate.eligibilityViolationCount}. Personalization remains capped at +/−6 in digest selection and +/−9 in Reader ranking.
              </p>
              {!recommendationGate.passed && recommendationGate.reasons.length ? (
                <p className="text-xs leading-relaxed text-muted-foreground">Waiting for: {recommendationGate.reasons.join("; ")}.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <CardTitle>Learned preferences</CardTitle>
              <CardDescription>Control how explicit feedback and reading behavior influence both the Digest Builder and Reader ranking.</CardDescription>
            </CardHeader>
            <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input
                  className="mt-0.5 size-4 accent-primary"
                  type="checkbox"
                  name="personalizationEnabled"
                  defaultChecked={settings.personalizationEnabled}
                />
                <span><span className="block font-medium">Use More / Less feedback</span><span className="mt-1 block text-xs text-muted-foreground">Explicit choices adjust selection without bypassing quality and security filters.</span></span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input
                  className="mt-0.5 size-4 accent-primary"
                  type="checkbox"
                  name="implicitPersonalizationEnabled"
                  defaultChecked={settings.implicitPersonalizationEnabled}
                />
                <span><span className="block font-medium">Learn from reading behavior (experimental)</span><span className="mt-1 block text-xs text-muted-foreground">Uses only positive, deduplicated opens, reads, and saves after at least five distinct stories. No click is never treated as negative feedback.</span></span>
              </label>
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Current evidence</p>
                  <Badge variant="outline">{learnedPreferences.evidenceCount} signals</Badge>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <div><p className="font-medium">Topics</p><p className="mt-1 text-muted-foreground">{learnedPreferences.feeds.map((item) => `${item.label} ${item.score > 0 ? "+" : ""}${item.score.toFixed(1)}`).join(", ") || "Not enough feedback yet"}</p></div>
                  <div><p className="font-medium">Sources</p><p className="mt-1 text-muted-foreground">{learnedPreferences.sources.map((item) => `${item.label} ${item.score > 0 ? "+" : ""}${item.score.toFixed(1)}`).join(", ") || "Not enough feedback yet"}</p></div>
                  <div><p className="font-medium">Keywords</p><p className="mt-1 text-muted-foreground">{learnedPreferences.keywords.map((item) => `${item.label} ${item.score > 0 ? "+" : ""}${item.score.toFixed(1)}`).join(", ") || "Not enough feedback yet"}</p></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span>{learnedPreferences.explicitEvidenceCount} explicit · {learnedPreferences.implicitEvidenceCount} behavioral</span>
                  <Button type="submit" variant="outline" size="sm" formAction={resetPersonalization} formNoValidate>
                    Reset learned data
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <CardTitle>Summary generation</CardTitle>
              <CardDescription>Fine tune fast-read length and AI-generated short summaries.</CardDescription>
            </CardHeader>
            <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
              <NumberField name="summaryMaxChars" label="Fast-read length" min={180} max={5000} defaultValue={settings.summaryMaxChars} />
              <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <input
                  className="size-4 accent-primary"
                  type="checkbox"
                  name="useAiSummaries"
                  defaultChecked={settings.useAiSummaries}
                />
                NVIDIA short summaries
                <Badge variant={hasNvidiaKey ? "secondary" : "outline"}>{hasNvidiaKey ? "key set" : "key missing"}</Badge>
              </label>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg">
              <Save aria-hidden="true" />
              Save advanced settings
            </Button>
          </div>
        </form>
      ) : null}

      {activeSettingsTab === "sources" ? (
        <Card className={SECTION_CARD_CLASS}>
          <CardHeader className={SECTION_HEADER_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Sources</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sourceCounts.enabled} enabled from {sourceCounts.sources} validated feeds
                </p>
              </div>
              <Badge variant="outline">{SOURCE_FEEDS.find((feed) => feed.id === activeSourceFeed)?.label}</Badge>
            </div>
          </CardHeader>
          <CardContent className={cn(SECTION_CONTENT_CLASS, "grid min-w-0 gap-5")}>
            {sourceSuggestions.length ? (
              <section className="grid gap-3 rounded-xl border bg-muted/20 p-3">
                <div>
                  <h2 className="text-sm font-semibold">Suggested changes</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Latest shadow proposal. Applying a suggestion changes the legacy manual switch; hard modes remain operator-owned.</p>
                </div>
                <div className="grid gap-2">
                  {sourceSuggestions.map((suggestion) => (
                    <div key={suggestion.decisionId} className="grid gap-2 rounded-lg border bg-background p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{suggestion.action === "add" ? "Add" : "Remove"}: {suggestion.sourceName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Score {suggestion.score.toFixed(1)} · confidence {Math.round(suggestion.confidence * 100)}% · {suggestion.runCount} runs · {suggestion.reasons.join("; ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <form action={applyPortfolioSuggestion}><input type="hidden" name="decisionId" value={suggestion.decisionId} /><Button type="submit" size="sm">Apply</Button></form>
                        {(["always_on", "auto", "blocked"] as const).map((mode) => (
                          <form key={mode} action={updateReaderSourceMode}>
                            <input type="hidden" name="sourceId" value={suggestion.sourceId} />
                            <input type="hidden" name="selectionMode" value={mode} />
                            <Button type="submit" size="sm" variant="outline">{mode === "always_on" ? "Always on" : mode === "auto" ? "Auto" : "Block"}</Button>
                          </form>
                        ))}
                        <form action={dismissPortfolioSuggestion}><input type="hidden" name="decisionId" value={suggestion.decisionId} /><Button type="submit" size="sm" variant="ghost">Dismiss</Button></form>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="grid min-w-0 gap-3">
              <div>
                <h2 className="text-sm font-semibold">Choose a category</h2>
                <p className="mt-1 text-xs text-muted-foreground">See every category at once and switch directly.</p>
              </div>
              <SourceTabs
                activeFeed={activeSourceFeed}
                activeKeywordGroups={activeKeywordGroups}
                activePreset={activePreset}
                groups={sourceGroups}
              />
            </section>

            <form action={saveReaderSources} className="grid min-w-0 gap-3">
              <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
              <input type="hidden" name="settingsTab" value="sources" />
              <input type="hidden" name="sourceCount" value={shownSourceCount} />
              <section className="grid min-w-0 gap-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {SOURCE_FEEDS.find((feed) => feed.id === activeSourceFeed)?.label}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">Toggle sources now. Open Edit only when you need URL or priority settings.</p>
                  </div>
                </div>
                <div className="grid min-w-0 gap-3">
                  {shownSourceGroups.map((group) =>
                    group.sources.length ? (
                      <section key={group.id} className="grid min-w-0 gap-2">
                        <div className="grid min-w-0 gap-2">
                          {group.sources.map((source) => {
                            const fieldNamePrefix = `sources.${sourceFieldIndex}`;
                            sourceFieldIndex += 1;

                            return (
                              <SourceEditor
                                key={source.id}
                                fieldNamePrefix={fieldNamePrefix}
                                quality={sourceQuality.get(source.id) || sourceQuality.get(source.url)}
                                source={source}
                              />
                            );
                          })}
                        </div>
                      </section>
                    ) : null,
                  )}
                </div>
              </section>

              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-3 py-3 shadow-lg backdrop-blur">
                <p className="text-xs text-muted-foreground">Changes to switches and details are saved together.</p>
                <Button type="submit" size="lg" disabled={!shownSourceCount}>
                  <Save aria-hidden="true" />
                  Save {shownSourceCount} sources
                </Button>
              </div>
            </form>

            <section className="grid gap-2 border-t pt-5">
              <h2 className="text-sm font-semibold">Optional tools</h2>
              <div className="grid gap-2 lg:grid-cols-2">
                <details className="rounded-xl border bg-muted/20" open={Boolean(discoveryUrl)}>
                  <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden">
                    <Plus className="mt-0.5 size-4 text-primary" aria-hidden="true" />
                    <span className="text-sm font-semibold">
                      Discover RSS/Atom automatically
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">Paste a website, article, or feed URL. Nothing is saved before confirmation.</span>
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t p-3">
                    <form action={startSourceDiscovery} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                      <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
                      <input type="hidden" name="settingsTab" value="sources" />
                      <div className="grid gap-2">
                        <Label htmlFor="source-discovery-url">Website, article, RSS, or Atom URL</Label>
                        <Input id="source-discovery-url" name="discoveryUrl" type="url" required maxLength={2000} defaultValue={discoveryUrl} placeholder="https://example.com/news" />
                      </div>
                      <Button type="submit" variant="outline">Discover</Button>
                    </form>
                    {discoveryResult.error ? (
                      <Alert variant="destructive"><AlertDescription>{discoveryResult.error}</AlertDescription></Alert>
                    ) : null}
                    {discoveryResult.proposal ? (
                      <form action={confirmSourceDiscovery} className="grid gap-3 rounded-lg border bg-background p-3">
                        <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
                        <input type="hidden" name="settingsTab" value="sources" />
                        <input type="hidden" name="discoveryUrl" value={discoveryUrl} />
                        <input type="hidden" name="feedUrl" value={discoveryResult.proposal.feedUrl} />
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{discoveryResult.proposal.feedType.toUpperCase()}</Badge>
                          <Badge variant="outline">{discoveryResult.proposal.language}</Badge>
                          <Badge variant="outline">{discoveryResult.proposal.sampleItemCount} sample items</Badge>
                          {discoveryResult.proposal.alreadyExists ? <Badge variant="destructive">Already exists</Badge> : null}
                        </div>
                        <p className="break-all text-xs text-muted-foreground">{discoveryResult.proposal.feedUrl}</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="grid gap-2"><Label htmlFor="discovery-name">Name</Label><Input id="discovery-name" name="name" required maxLength={200} defaultValue={discoveryResult.proposal.name} /></div>
                          <div className="grid gap-2"><Label htmlFor="discovery-category">Category</Label><Input id="discovery-category" name="category" required maxLength={200} defaultValue={discoveryResult.proposal.category} /></div>
                        </div>
                        <p className="text-xs text-muted-foreground">Confirmation repeats URL, DNS, redirect, size, and feed validation. The source is saved disabled in Auto mode and must pass probe evaluation.</p>
                        <div className="flex justify-end"><Button type="submit" disabled={discoveryResult.proposal.alreadyExists}>Confirm and add source</Button></div>
                      </form>
                    ) : null}
                  </div>
                </details>

                <details className="rounded-xl border bg-muted/20">
                  <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    Start from a preset
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">Replace active choices across all categories.</span>
                  </summary>
                  <div className="border-t p-3">
                    <SourcePresetControls activeSourceFeed={activeSourceFeed} />
                  </div>
                </details>

                <details className="rounded-xl border bg-muted/20">
                  <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden">
                    <Plus className="mt-0.5 size-4 text-primary" aria-hidden="true" />
                    <span className="text-sm font-semibold">
                      Add custom RSS feed
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">Use a feed that is not in the curated catalog.</span>
                    </span>
                  </summary>
                  <form action={saveReaderSource} className="grid gap-3 border-t p-3">
                    <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
                    <input type="hidden" name="settingsTab" value="sources" />
                    <SourceFields />
                    <div className="flex justify-end">
                      <Button type="submit" size="lg">
                        <Plus aria-hidden="true" />
                        Add source
                      </Button>
                    </div>
                  </form>
                </details>
              </div>
            </section>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
