import { ExternalLink, Info, SlidersHorizontal } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
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
import { localeTag, localize, type ReaderLocale } from "@/lib/reader-locale";
import { getReaderLocale } from "@/lib/reader-locale-server";

export const dynamic = "force-dynamic";
const DISPLAY_TIME_ZONE = "Europe/Warsaw";

type NewsDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatDate(value: string | null, locale: ReaderLocale) {
  if (!value) {
    return localize(locale, "Brak daty publikacji", "No publication date");
  }

  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function formatScoreValue(value: unknown, locale: ReaderLocale) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 1 }).format(value)
    : String(value);
}

function localizedPriority(score: number, locale: ReaderLocale) {
  const label = priorityLabel(score);
  if (label === "Critical") return localize(locale, "Krytyczne", "Critical");
  if (label === "Important") return localize(locale, "Ważne", "Important");
  if (label === "Useful") return localize(locale, "Przydatne", "Useful");
  return localize(locale, "Tło", "Background");
}

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
  const { id } = await params;
  const [user, locale] = await Promise.all([requireCurrentReader(), getReaderLocale()]);
  const item = await getReaderNewsItem(id, user.id);

  if (!item) {
    notFound();
  }

  const isRead = Boolean(item.readAt);
  const isSaved = Boolean(item.savedAt);
  const scoreComponents = Object.entries(item.scoreComponents);

  return (
    <>
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <PageHeader
        backHref="/news"
        title={localize(locale, "Szczegóły wiadomości", "Story details")}
        description={localize(locale, "Czytaj, zapisz albo dopasuj kolejne rekomendacje.", "Read, save, or fine-tune future recommendations.")}
      />

      <section
        className="-mx-4 flex flex-wrap items-center gap-2 border-y bg-card/70 p-3 md:mx-0 md:rounded-xl md:border md:p-2 md:shadow-sm"
        aria-label={localize(locale, "Akcje wiadomości", "Story actions")}
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

      <Card className="-mx-4 rounded-none border-y border-border/70 bg-card/80 shadow-none ring-0 md:mx-0 md:rounded-xl md:shadow-sm md:ring-1">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="bg-accent text-accent-foreground">
              {item.category}
            </Badge>
            <span>{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(item.publishedAt, locale)}</span>
            <Badge variant="outline">{localizedPriority(item.editorialScore, locale)}</Badge>
            {item.sourceCount > 1 ? <Badge variant="outline">{item.sourceCount} {localize(locale, "źródeł", "sources")}</Badge> : null}
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
                  {localize(locale, "Dlaczego ten news?", "Why this story?")}
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
                  <h2 className="text-lg font-semibold">{localize(locale, "Treść artykułu", "Article content")}</h2>
                  <span className="text-xs text-muted-foreground">
                    {item.cachedArticle.wordCount.toLocaleString(localeTag(locale))} {localize(locale, "słów", "words")}
                    {item.cachedArticle.source !== item.source ? ` · ${item.cachedArticle.source}` : ""}
                  </span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {localize(locale, "Kopia została zapisana, gdy artykuł był publicznie dostępny. Źródło mogło od tego czasu się zmienić.", "This copy was saved while the article was publicly available. The source may have changed since then.")}
                </p>
                <div className="grid gap-4 text-[0.98rem] leading-7 text-foreground/90">
                  {item.cachedArticle.text.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 32)}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ) : (
              <section className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                {localize(locale, "Pełna treść nie była dostępna podczas pobierania. Źródło może wymagać konta albo subskrypcji.", "The full text was not available when the story was fetched. The source may require an account or subscription.")}
              </section>
            )}
          </SelectableNoteRegion>
          {scoreComponents.length ? (
            <details className="rounded-lg border bg-muted/20">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden="true" className="size-4 text-primary" />
                {localize(locale, "Szczegóły oceny", "Scoring details")}
              </summary>
              <div className="flex flex-wrap gap-2 border-t p-3">
                {scoreComponents.map(([key, value]) => (
                  <Badge key={key} variant="outline">
                    {formatScoreComponentLabel(key)}: {formatScoreValue(value, locale)}
                  </Badge>
                ))}
              </div>
            </details>
          ) : null}

          {item.sourceVariants.length > 1 ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">{localize(locale, "Źródła", "Sources")}</h2>
              <div className="grid gap-2">
                {item.sourceVariants.map((source) => (
                  <a key={source.articleId} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm hover:bg-muted/40" href={source.url} target="_blank" rel="noreferrer">
                    <span>{source.name}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(source.publishedAt, locale)}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {item.updateHistory.length ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">{localize(locale, "Historia newsa", "Story history")}</h2>
              <ol className="grid gap-2">
                {item.updateHistory.map((update) => (
                  <li key={update.digestRunId} className="border-l-2 border-primary/30 pl-3 text-sm">
                    <p className="font-medium">{update.changedFields.includes("new") ? localize(locale, "Pierwszy wybór", "First selected") : localize(locale, "Aktualizacja", "Update")}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(update.createdAt, locale)} · {update.changedFields.includes("new") ? localize(locale, "nowy", "new") : update.changedFields.join(", ") || localize(locale, "bez istotnych zmian", "no significant changes")}</p>
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
            {localize(locale, "Otwórz źródło", "Open source")}
          </a>
        </CardContent>
      </Card>
    </main>
    <MobileBottomNav />
    </>
  );
}
