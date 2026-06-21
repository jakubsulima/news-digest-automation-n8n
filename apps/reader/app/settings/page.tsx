import { ArrowLeft, Plus, Save } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveReaderDigestSettings, saveReaderSource } from "@/lib/actions";
import { hasNvidiaSummaryConfig } from "@/lib/ai-summary";
import { requireCurrentReader } from "@/lib/auth";
import { getReaderDigestSettings } from "@/lib/digest-settings";
import { getReaderSources, type ReaderSource } from "@/lib/reader-sources";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
  "migration-required": "Settings cannot be saved until the reader_digest_settings Supabase migration is applied.",
  "save-failed": "Settings could not be saved. Check the server log for the database error.",
  saved: "Settings saved.",
  "source-invalid": "Source could not be saved. Check the URL, name, category, and priority.",
  "source-save-failed": "Source could not be saved. Check the server log for the database error.",
  "source-saved": "Source saved.",
} as const;

type SettingsPageProps = {
  searchParams?: Promise<{
    status?: string | string[];
  }>;
};

function keywordValue(keywords: string[]) {
  return keywords.join(", ");
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

function SourceFields({ source }: { source?: ReaderSource }) {
  return (
    <>
      {source ? <input type="hidden" name="id" value={source.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-2">
          <Label htmlFor={source ? `source-name-${source.id}` : "source-name-new"}>Name</Label>
          <Input
            id={source ? `source-name-${source.id}` : "source-name-new"}
            name="name"
            defaultValue={source?.name}
            required
            maxLength={200}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={source ? `source-url-${source.id}` : "source-url-new"}>Feed URL</Label>
          <Input
            id={source ? `source-url-${source.id}` : "source-url-new"}
            name="url"
            type="url"
            defaultValue={source?.url}
            required
            maxLength={2000}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor={source ? `source-category-${source.id}` : "source-category-new"}>Category</Label>
          <Input
            id={source ? `source-category-${source.id}` : "source-category-new"}
            name="category"
            defaultValue={source?.category}
            required
            maxLength={200}
          />
        </div>
        <NumberField
          name="priority"
          label="Priority"
          min={1}
          max={5}
          defaultValue={source?.priority ?? 3}
        />
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

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireCurrentReader();
  const [settings, sources] = await Promise.all([getReaderDigestSettings(user.id), getReaderSources()]);
  const hasNvidiaKey = hasNvidiaSummaryConfig();
  const rawStatus = (await searchParams)?.status;
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  const statusCopy = status && status in STATUS_COPY ? STATUS_COPY[status as keyof typeof STATUS_COPY] : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
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
        <Alert variant={status === "saved" || status === "source-saved" ? "default" : "destructive"}>
          <AlertDescription>{statusCopy}</AlertDescription>
        </Alert>
      ) : null}

      <form action={saveReaderDigestSettings} className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Selection</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                name="publishTopN"
                label="Articles per digest"
                min={5}
                max={100}
                defaultValue={settings.publishTopN}
              />
              <NumberField
                name="minimumImportanceScore"
                label="Minimum score"
                min={0}
                max={100}
                defaultValue={settings.minimumImportanceScore}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-5">
              <NumberField
                name="feedTargetGeopolitics"
                label="Geopolitics"
                min={0}
                max={50}
                defaultValue={settings.feedTargets.geopolitics}
              />
              <NumberField
                name="feedTargetBusiness"
                label="Business"
                min={0}
                max={50}
                defaultValue={settings.feedTargets.business}
              />
              <NumberField name="feedTargetAi" label="AI" min={0} max={50} defaultValue={settings.feedTargets.ai} />
              <NumberField
                name="feedTargetSoftware"
                label="Software"
                min={0}
                max={50}
                defaultValue={settings.feedTargets.software}
              />
              <NumberField
                name="feedTargetSecurity"
                label="Security"
                min={0}
                max={50}
                defaultValue={settings.feedTargets.security}
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
            <CardTitle>Reading</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <NumberField
              name="summaryMaxChars"
              label="Fast-read length"
              min={180}
              max={5000}
              defaultValue={settings.summaryMaxChars}
            />

            <div className="grid gap-2">
              <Label htmlFor="preferredKeywords">Prefer keywords</Label>
              <textarea
                id="preferredKeywords"
                name="preferredKeywords"
                className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                defaultValue={keywordValue(settings.preferredKeywords)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="excludedKeywords">Avoid keywords</Label>
              <textarea
                id="excludedKeywords"
                name="excludedKeywords"
                className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                defaultValue={keywordValue(settings.excludedKeywords)}
              />
            </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form action={saveReaderSource} className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Add source</h2>
            </div>
            <SourceFields />
            <div className="flex justify-end">
              <Button type="submit" size="lg">
                <Plus aria-hidden="true" />
                Add source
              </Button>
            </div>
          </form>

          <div className="grid gap-3">
            {sources.map((source) => (
              <form key={source.id} action={saveReaderSource} className="grid gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{source.name}</h2>
                    <p className="truncate text-xs text-muted-foreground">{source.url}</p>
                  </div>
                  <Badge variant={source.enabled ? "secondary" : "outline"}>
                    {source.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
                <SourceFields source={source} />
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" size="lg">
                    <Save aria-hidden="true" />
                    Save source
                  </Button>
                </div>
              </form>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
