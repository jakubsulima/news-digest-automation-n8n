import { ExternalLink, Info, SlidersHorizontal } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemFeedbackActions } from "@/components/news-item-feedback-actions";
import { NewsItemActions } from "@/components/news-item-actions";
import { NewsNoteAction } from "@/components/news-note-action";
import { NewsPreviewCard } from "@/components/news-preview-card";
import { SelectableNoteRegion } from "@/components/selectable-note-region";
import { requireCurrentReader } from "@/lib/auth";
import { getReaderNewsItem } from "@/lib/news";
import { formatScoreComponentLabel } from "@/lib/news-display";
import { priorityLabel } from "@/lib/reader-feed-ranking";

export const dynamic = "force-dynamic";
const DISPLAY_TIME_ZONE = "Europe/Warsaw";

type NewsDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatDate(value: string | null) {
  if (!value) {
    return "No publication date";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function formatScoreValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)
    : String(value);
}

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
  const { id } = await params;
  const user = await requireCurrentReader();
  const item = await getReaderNewsItem(id, user.id);

  if (!item) {
    notFound();
  }

  const isRead = Boolean(item.readAt);
  const isSaved = Boolean(item.savedAt);
  const scoreComponents = Object.entries(item.scoreComponents);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <PageHeader
        title="Szczegóły wiadomości"
        description="Czytaj, zapisz albo dopasuj kolejne rekomendacje."
      />

      <section
        className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/80 p-2 shadow-sm"
        aria-label="Akcje wiadomości"
      >
        <NewsNoteAction
          buttonSize="sm"
          itemId={item.id}
          initialCount={item.noteCount}
          showLabel
        />
        <NewsItemActions
          buttonSize="sm"
          itemId={item.id}
          isRead={isRead}
          isSaved={isSaved}
          showLabels
        />
        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <NewsItemFeedbackActions
          buttonSize="sm"
          itemId={item.id}
          feedback={item.feedback}
          feedbackReason={item.feedbackReason}
          showLabels
        />
      </section>

      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="bg-accent text-accent-foreground">
              {item.category}
            </Badge>
            <span>{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(item.publishedAt)}</span>
            <Badge variant="outline">{priorityLabel(item.editorialScore)}</Badge>
            {item.sourceCount > 1 ? <Badge variant="outline">{item.sourceCount} sources</Badge> : null}
          </div>

          <CardTitle className="text-xl leading-tight sm:text-2xl">
            {item.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <SelectableNoteRegion articleId={item.cachedArticle?.articleId} newsItemId={item.id}>
            <NewsPreviewCard preview={item.preview} summary={item.summary} />
            {!item.preview && (item.whyInteresting || item.recommendedAction) ? (
              <details className="rounded-lg border bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <Info aria-hidden="true" className="size-4 text-primary" />
                  Dlaczego ten news?
                </summary>
                <section className="grid gap-2 border-t px-3 py-3 text-sm leading-6 text-muted-foreground">
                  {item.whyInteresting ? <p>{item.whyInteresting}</p> : null}
                  {item.recommendedAction ? <p>{item.recommendedAction}</p> : null}
                </section>
              </details>
            ) : null}
            {item.cachedArticle ? (
              <section className="grid gap-4 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Cached article</h2>
                  <span className="text-xs text-muted-foreground">
                    {item.cachedArticle.wordCount.toLocaleString("en-US")} words
                    {item.cachedArticle.source !== item.source ? ` · ${item.cachedArticle.source}` : ""}
                  </span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Reader copy captured when the article was publicly accessible. The source may have changed since then.
                </p>
                <div className="grid gap-4 text-[0.98rem] leading-7 text-foreground/90">
                  {item.cachedArticle.text.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 32)}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ) : (
              <section className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                A full reader copy was not available when this story was collected. The source may require an account or subscription.
              </section>
            )}
          </SelectableNoteRegion>
          {scoreComponents.length ? (
            <details className="rounded-lg border bg-muted/20">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden="true" className="size-4 text-primary" />
                Szczegóły oceny
              </summary>
              <div className="flex flex-wrap gap-2 border-t p-3">
                {scoreComponents.map(([key, value]) => (
                  <Badge key={key} variant="outline">
                    {formatScoreComponentLabel(key)}: {formatScoreValue(value)}
                  </Badge>
                ))}
              </div>
            </details>
          ) : null}

          {item.sourceVariants.length > 1 ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">Sources</h2>
              <div className="grid gap-2">
                {item.sourceVariants.map((source) => (
                  <a key={source.articleId} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm hover:bg-muted/40" href={source.url} target="_blank" rel="noreferrer">
                    <span>{source.name}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(source.publishedAt)}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {item.updateHistory.length ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">Story updates</h2>
              <ol className="grid gap-2">
                {item.updateHistory.map((update) => (
                  <li key={update.digestRunId} className="border-l-2 border-primary/30 pl-3 text-sm">
                    <p className="font-medium">{update.changedFields.includes("new") ? "First selected" : "Updated"}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(update.createdAt)} · {update.changedFields.join(", ") || "No material changes"}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <a
            className={buttonVariants({ variant: "outline", size: "lg" })}
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            Source
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
