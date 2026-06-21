import { ArrowLeft, Plus, Save, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { saveReaderDigestSettings, saveReaderSource, saveReaderSourcePreset } from "@/lib/actions";
import { hasNvidiaSummaryConfig } from "@/lib/ai-summary";
import { requireCurrentReader } from "@/lib/auth";
import {
  getReaderDigestSettings,
  type DigestFeedTargets,
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
} as const;

const SUCCESS_STATUSES = new Set(["saved", "source-preset-saved", "source-saved"]);
const PRESET_CARD_CLASS =
  "h-auto min-h-20 w-full flex-col items-start gap-1 whitespace-normal px-3 py-2 text-left";

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

type DigestPresetId = (typeof DIGEST_PRESETS)[number]["id"];
type SourceGroup = {
  enabledCount: number;
  id: Exclude<ReaderFeedId, "all">;
  label: string;
  sources: ReaderSource[];
};

type SettingsPageProps = {
  searchParams?: Promise<{
    preset?: string | string[];
    sourceFeed?: string | string[];
    status?: string | string[];
  }>;
};

const DIGEST_PRESET_IDS = new Set<DigestPresetId>(DIGEST_PRESETS.map((preset) => preset.id));

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isSuccessStatus(status: string | undefined) {
  return status ? SUCCESS_STATUSES.has(status) : false;
}

function normalizeDigestPresetId(value: string | string[] | undefined): DigestPresetId | null {
  const presetId = firstSearchValue(value);

  return presetId && DIGEST_PRESET_IDS.has(presetId as DigestPresetId) ? (presetId as DigestPresetId) : null;
}

function settingsHref({
  preset,
  sourceFeed,
}: {
  preset?: DigestPresetId | null;
  sourceFeed?: ReaderFeedId;
}) {
  const params = new URLSearchParams();

  if (preset) {
    params.set("preset", preset);
  }

  if (sourceFeed && sourceFeed !== "all") {
    params.set("sourceFeed", sourceFeed);
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

function keywordValue(keywords: string[]) {
  return keywords.join(", ");
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
  label,
  max,
  min,
  name,
}: {
  defaultValue: number;
  label: string;
  max: number;
  min: number;
  name: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={min} max={max} defaultValue={defaultValue} />
    </div>
  );
}

function FeedTargetFields({ feedTargets }: { feedTargets: DigestFeedTargets }) {
  return (
    <div className="grid gap-3 sm:grid-cols-5">
      <NumberField name="feedTargetGeopolitics" label="Geopolitics" min={0} max={50} defaultValue={feedTargets.geopolitics} />
      <NumberField name="feedTargetBusiness" label="Business" min={0} max={50} defaultValue={feedTargets.business} />
      <NumberField name="feedTargetAi" label="AI" min={0} max={50} defaultValue={feedTargets.ai} />
      <NumberField name="feedTargetSoftware" label="Software" min={0} max={50} defaultValue={feedTargets.software} />
      <NumberField name="feedTargetSecurity" label="Security" min={0} max={50} defaultValue={feedTargets.security} />
    </div>
  );
}

function TextAreaField({
  defaultValue,
  label,
  name,
}: {
  defaultValue: string;
  label: string;
  name: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        defaultValue={defaultValue}
      />
    </div>
  );
}

function SourceFields({ source }: { source?: ReaderSource }) {
  const sourceFieldId = source?.id ?? "new";

  return (
    <>
      {source ? <input type="hidden" name="id" value={source.id} /> : null}
      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-2">
          <Label htmlFor={`source-name-${sourceFieldId}`}>Name</Label>
          <Input
            id={`source-name-${sourceFieldId}`}
            name="name"
            defaultValue={source?.name}
            required
            maxLength={200}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`source-url-${sourceFieldId}`}>Feed URL</Label>
          <Input
            id={`source-url-${sourceFieldId}`}
            name="url"
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
            name="category"
            defaultValue={source?.category}
            required
            maxLength={200}
          />
        </div>
        <NumberField name="priority" label="Priority" min={1} max={5} defaultValue={source?.priority ?? 3} />
        <label className="flex h-8 items-center gap-2 text-sm font-medium">
          <input
            className="size-4 accent-primary"
            type="checkbox"
            name="enabled"
            defaultChecked={source?.enabled ?? true}
          />
          Enabled
        </label>
      </div>
    </>
  );
}

function DigestPresetLinks({
  activePreset,
  activeSourceFeed,
}: {
  activePreset: DigestPresetId | null;
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
            href={settingsHref({ preset: preset.id, sourceFeed: activeSourceFeed })}
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

function SourcePresetControls({ activeSourceFeed }: { activeSourceFeed: ReaderFeedId }) {
  return (
    <div className="grid gap-2 lg:grid-cols-5">
      {SOURCE_PRESETS.map((preset) => (
        <form key={preset.id} action={saveReaderSourcePreset}>
          <input type="hidden" name="sourcePreset" value={preset.id} />
          <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
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
  activePreset,
  groups,
}: {
  activeFeed: ReaderFeedId;
  activePreset: DigestPresetId | null;
  groups: SourceGroup[];
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1" aria-label="Source groups">
      {READER_FEEDS.map((feed) => {
        const active = feed.id === activeFeed;
        const count = sourceTabCount(groups, feed.id);

        return (
          <Link
            key={feed.id}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
            )}
            href={settingsHref({ preset: activePreset, sourceFeed: feed.id })}
          >
            {feed.label}
            <span className="rounded-full border px-1.5 py-0.5 text-[0.7rem] leading-none">
              {count.enabled}/{count.sources}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SourceEditor({ activeSourceFeed, source }: { activeSourceFeed: ReaderFeedId; source: ReaderSource }) {
  return (
    <form action={saveReaderSource}>
      <input type="hidden" name="sourceFeed" value={activeSourceFeed} />
      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{source.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{source.category}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={source.enabled ? "secondary" : "outline"}>{source.enabled ? "on" : "off"}</Badge>
            <Badge variant="outline">P{source.priority}</Badge>
            <span className="text-xs text-muted-foreground group-open:hidden">Edit</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">Close</span>
          </div>
        </summary>
        <div className="grid gap-3 border-t p-3">
          <p className="truncate text-xs text-muted-foreground">{source.url}</p>
          <SourceFields source={source} />
          <div className="flex justify-end">
            <Button type="submit" variant="outline" size="lg">
              <Save aria-hidden="true" />
              Save source
            </Button>
          </div>
        </div>
      </details>
    </form>
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireCurrentReader();
  const rawSearchParams = await searchParams;
  const activeSourceFeed = normalizeReaderFeedId(rawSearchParams?.sourceFeed);
  const activePreset = normalizeDigestPresetId(rawSearchParams?.preset);
  const [savedSettings, sources] = await Promise.all([getReaderDigestSettings(user.id), getReaderSources()]);
  const settings = applyDigestPreset(savedSettings, activePreset);
  const sourceGroups = groupedSources(sources);
  const shownSourceGroups = visibleSourceGroups(sourceGroups, activeSourceFeed);
  const sourceCounts = sourceTabCount(sourceGroups, "all");
  const hasNvidiaKey = hasNvidiaSummaryConfig();
  const rawStatus = firstSearchValue(rawSearchParams?.status);
  const statusCopy = rawStatus && rawStatus in STATUS_COPY ? STATUS_COPY[rawStatus as keyof typeof STATUS_COPY] : null;

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)] xl:items-start">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Theme applies across the reader.</CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeToggle />
            </CardContent>
          </Card>

          <form key={`digest-${activePreset ?? "saved"}`} action={saveReaderDigestSettings} className="grid gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Digest presets</CardTitle>
                    <CardDescription>Start with a balanced mix or bias the digest toward a topic.</CardDescription>
                  </div>
                  {activePreset ? <Badge variant="secondary">preset pending</Badge> : null}
                </div>
              </CardHeader>
              <CardContent>
                <DigestPresetLinks activePreset={activePreset} activeSourceFeed={activeSourceFeed} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Output limits</CardTitle>
                <CardDescription>Control digest size and the minimum score needed to publish an item.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
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

            <Card>
              <CardHeader>
                <CardTitle>Category targets</CardTitle>
                <CardDescription>Set how many stories each feed contributes before final ranking.</CardDescription>
              </CardHeader>
              <CardContent>
                <FeedTargetFields feedTargets={settings.feedTargets} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reading filters</CardTitle>
                <CardDescription>Tune fast-read summaries and keyword preferences.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <NumberField name="summaryMaxChars" label="Fast-read length" min={180} max={5000} defaultValue={settings.summaryMaxChars} />
                <TextAreaField
                  name="preferredKeywords"
                  label="Prefer keywords"
                  defaultValue={keywordValue(settings.preferredKeywords)}
                />
                <TextAreaField
                  name="excludedKeywords"
                  label="Avoid keywords"
                  defaultValue={keywordValue(settings.excludedKeywords)}
                />
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
                Save settings
              </Button>
            </div>
          </form>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Sources</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sourceCounts.enabled} enabled from {sourceCounts.sources} validated feeds
                </p>
              </div>
              <Badge variant="outline">{activeSourceFeed === "all" ? "All groups" : READER_FEEDS.find((feed) => feed.id === activeSourceFeed)?.label}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
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
                <p className="mt-1 text-xs text-muted-foreground">Filter the list by feed category.</p>
              </div>
              <SourceTabs activeFeed={activeSourceFeed} activePreset={activePreset} groups={sourceGroups} />
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

            <section className="grid gap-3">
              <div>
                <h2 className="text-sm font-semibold">Source list</h2>
                <p className="mt-1 text-xs text-muted-foreground">Open a row to edit its URL, category, priority, or enabled state.</p>
              </div>
              <div className="grid gap-5">
                {shownSourceGroups.map((group) =>
                  group.sources.length ? (
                    <section key={group.id} className="grid gap-2">
                      {activeSourceFeed === "all" ? (
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="text-sm font-semibold">{group.label}</h2>
                          <Badge variant="outline">
                            {group.enabledCount}/{group.sources.length}
                          </Badge>
                        </div>
                      ) : null}

                      <div className="grid gap-2">
                        {group.sources.map((source) => (
                          <SourceEditor key={source.id} activeSourceFeed={activeSourceFeed} source={source} />
                        ))}
                      </div>
                    </section>
                  ) : null,
                )}
              </div>
            </section>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
              Source presets update the enabled feed set; individual rows remain editable afterward.
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
