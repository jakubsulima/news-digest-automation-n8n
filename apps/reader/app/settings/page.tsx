import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Save, SlidersHorizontal } from "lucide-react";
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
import { saveReaderDigestSettings, saveReaderSource, saveReaderSourcePreset, saveReaderSources } from "@/lib/actions";
import { hasNvidiaSummaryConfig } from "@/lib/ai-summary";
import { requireCurrentReader } from "@/lib/auth";
import {
  getReaderDigestSettings,
  type ReaderDigestSettings,
} from "@/lib/digest-settings";
import { READER_FEEDS, normalizeReaderFeedId, readerFeedForCategory, type ReaderFeedId } from "@/lib/feed-categories";
import { getReaderSources, SOURCE_PRESETS, type ReaderSource } from "@/lib/reader-sources";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
  "migration-required": "Settings cannot be saved until the reader_digest_settings Supabase migration is applied.",
  "save-failed": "Settings could not be saved. Check the server log for the database error.",
  saved: "Settings saved.",
  "source-invalid": "Source could not be saved. Check the URL, name, category, and priority.",
  "source-preset-saved": "Source preset applied.",
  "source-save-failed": "Source could not be saved. Check the server log for the database error.",
  "source-saved": "Source saved.",
  "sources-saved": "Sources saved.",
} as const;

const SUCCESS_STATUSES = new Set(["saved", "source-preset-saved", "source-saved", "sources-saved"]);
const PRESET_CARD_CLASS =
  "h-auto min-h-20 w-full flex-col items-start gap-1 whitespace-normal px-3 py-2 text-left";
const SECTION_CARD_CLASS = "rounded-none bg-transparent py-0 ring-0";
const SECTION_HEADER_CLASS = "px-0";
const SECTION_CONTENT_CLASS = "px-0";

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
      <input type="hidden" name="summaryMaxChars" value={settings.summaryMaxChars} />
      <input type="hidden" name="useAiSummaries" value={settings.useAiSummaries ? "on" : "off"} />
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
      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-2">
          <Label htmlFor={`source-name-${sourceFieldId}`}>Name</Label>
          <Input
            id={`source-name-${sourceFieldId}`}
            name={sourceFieldName("name", fieldNamePrefix)}
            defaultValue={source?.name}
            required
            maxLength={200}
          />
        </div>
        <div className="grid gap-2">
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
      <div className="grid gap-3 lg:grid-cols-[1fr_7rem_auto] lg:items-end">
        <div className="grid gap-2">
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
    <div className="grid gap-2 lg:grid-cols-5">
      {SOURCE_PRESETS.map((preset) => (
        <form key={preset.id} action={saveReaderSourcePreset}>
          <input type="hidden" name="sourcePreset" value={preset.id} />
          <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
          <input type="hidden" name="settingsTab" value="sources" />
          <Button
            type="submit"
            variant="outline"
            className={PRESET_CARD_CLASS}
          >
            <span className="font-semibold">{preset.label}</span>
            <span className="text-xs font-normal text-muted-foreground">{preset.description}</span>
          </Button>
        </form>
      ))}
    </div>
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
  const activeIndex = Math.max(
    0,
    SOURCE_FEEDS.findIndex((feed) => feed.id === activeFeed),
  );
  const activeSourceFeed = SOURCE_FEEDS[activeIndex] ?? SOURCE_FEEDS[0];
  const previousSourceFeed = SOURCE_FEEDS[(activeIndex - 1 + SOURCE_FEEDS.length) % SOURCE_FEEDS.length];
  const nextSourceFeed = SOURCE_FEEDS[(activeIndex + 1) % SOURCE_FEEDS.length];
  const count = sourceTabCount(groups, activeSourceFeed.id);
  const sharedHrefParams = {
    avoidKeywordGroups: activeKeywordGroups.avoid,
    preferKeywordGroups: activeKeywordGroups.prefer,
    preset: activePreset,
    settingsTab: "sources" as const,
  };

  return (
    <nav className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2" aria-label="Source groups">
      <Link
        className={buttonVariants({ variant: "outline", size: "icon-lg" })}
        href={settingsHref({
          ...sharedHrefParams,
          sourceFeed: previousSourceFeed.id,
        })}
        scroll={false}
        title={`Show ${previousSourceFeed.label}`}
        aria-label={`Show ${previousSourceFeed.label}`}
      >
        <ChevronLeft aria-hidden="true" />
      </Link>
      <div className="grid min-w-0 flex-1 justify-items-center gap-1 px-2 text-center">
        <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Current category</span>
        <span className="truncate text-base font-semibold leading-tight">{activeSourceFeed.label}</span>
        <Badge variant="outline">
          {count.enabled}/{count.sources} enabled
        </Badge>
      </div>
      <Link
        className={buttonVariants({ variant: "outline", size: "icon-lg" })}
        href={settingsHref({
          ...sharedHrefParams,
          sourceFeed: nextSourceFeed.id,
        })}
        scroll={false}
        title={`Show ${nextSourceFeed.label}`}
        aria-label={`Show ${nextSourceFeed.label}`}
      >
        <ChevronRight aria-hidden="true" />
      </Link>
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

function SourceEditor({ fieldNamePrefix, source }: { fieldNamePrefix: string; source: ReaderSource }) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{source.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{source.category}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SourceEnabledToggle defaultEnabled={source.enabled} name={sourceFieldName("enabled", fieldNamePrefix)} />
          <Badge variant="outline">P{source.priority}</Badge>
          <span className="text-xs text-muted-foreground group-open:hidden">Edit</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">Close</span>
        </div>
      </summary>
      <div className="grid gap-3 border-t p-3">
        <p className="truncate text-xs text-muted-foreground">{source.url}</p>
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
  const queryKeywordGroups: ActiveKeywordGroups = {
    avoid: normalizeKeywordGroupIds("avoid", rawSearchParams?.avoidKeywordGroup),
    prefer: normalizeKeywordGroupIds("prefer", rawSearchParams?.preferKeywordGroup),
  };
  const [savedSettings, sources] = await Promise.all([getReaderDigestSettings(user.id), getReaderSources()]);
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
              <CardTitle>Advanced settings</CardTitle>
              <CardDescription>Fine tune summary length and AI-generated short summaries.</CardDescription>
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
          <CardContent className={cn(SECTION_CONTENT_CLASS, "grid gap-4")}>
            <section className="grid gap-2">
              <div>
                <h2 className="text-sm font-semibold">Source presets</h2>
                <p className="mt-1 text-xs text-muted-foreground">Apply a curated source set before editing individual feeds.</p>
              </div>
              <SourcePresetControls activeSourceFeed={activeSourceFeed} />
            </section>

            <section className="grid gap-2">
              <div>
                <h2 className="text-sm font-semibold">Source groups</h2>
                <p className="mt-1 text-xs text-muted-foreground">Move between feed categories.</p>
              </div>
              <SourceTabs
                activeFeed={activeSourceFeed}
                activeKeywordGroups={activeKeywordGroups}
                activePreset={activePreset}
                groups={sourceGroups}
              />
            </section>

            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">Add source</h2>
              <details className="rounded-lg border bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                  <Plus className="size-4 text-primary" aria-hidden="true" />
                  <span className="text-sm font-semibold">Custom RSS feed</span>
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
            </section>

            <form action={saveReaderSources} className="grid gap-3">
              <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
              <input type="hidden" name="settingsTab" value="sources" />
              <input type="hidden" name="sourceCount" value={shownSourceCount} />
              <section className="grid gap-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Source list</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Open rows to edit URLs, categories, priorities, or enabled states.</p>
                  </div>
                </div>
                <div className="grid gap-5">
                  {shownSourceGroups.map((group) =>
                    group.sources.length ? (
                      <section key={group.id} className="grid gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="text-sm font-semibold">{group.label}</h2>
                          <Badge variant="outline">
                            {group.enabledCount}/{group.sources.length}
                          </Badge>
                        </div>

                        <div className="grid gap-2">
                          {group.sources.map((source) => {
                            const fieldNamePrefix = `sources.${sourceFieldIndex}`;
                            sourceFieldIndex += 1;

                            return <SourceEditor key={source.id} fieldNamePrefix={fieldNamePrefix} source={source} />;
                          })}
                        </div>
                      </section>
                    ) : null,
                  )}
                </div>
              </section>

              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={!shownSourceCount}>
                  <Save aria-hidden="true" />
                  Save sources
                </Button>
              </div>
            </form>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
              Source presets update the enabled feed set; individual rows remain editable afterward.
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
