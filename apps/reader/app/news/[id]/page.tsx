import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemFeedbackActions } from "@/components/news-item-feedback-actions";
import { NewsItemActions } from "@/components/news-item-actions";
import { NewsPreviewCard } from "@/components/news-preview-card";
import { requireCurrentReader } from "@/lib/auth";
import { getReaderNewsItem } from "@/lib/news";
import { formatPracticalBucket, formatScoreComponentLabel } from "@/lib/news-display";
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

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
  const { id } = await params;
  const user = await requireCurrentReader();
  const item = await getReaderNewsItem(id, user.id);

  if (!item) {
    notFound();
  }

  const isRead = Boolean(item.readAt);
  const isSaved = Boolean(item.savedAt);
  const isArchived = Boolean(item.archivedAt);
  const scoreComponents = Object.entries(item.scoreComponents);

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
        <div className="flex items-center gap-2">
          <NewsItemActions itemId={item.id} isRead={isRead} isSaved={isSaved} isArchived={isArchived} />
          <NewsItemFeedbackActions itemId={item.id} feedback={item.feedback} feedbackReason={item.feedbackReason} />
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="bg-accent text-accent-foreground">
              {item.category}
            </Badge>
            {item.practicalBucket ? <Badge variant="outline">{formatPracticalBucket(item.practicalBucket)}</Badge> : null}
            <span>{item.source}</span>
            <span>{formatDate(item.publishedAt)}</span>
            <Badge variant="outline">{priorityLabel(item.editorialScore)}</Badge>
            {item.sourceCount > 1 ? <Badge variant="outline">{item.sourceCount} sources</Badge> : null}
          </div>

          <CardTitle className="text-xl leading-tight sm:text-2xl">
            <a className="hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <NewsPreviewCard preview={item.preview} summary={item.summary} />
          {!item.preview && (item.whyInteresting || item.recommendedAction) ? (
            <section className="grid gap-2 rounded-md border border-border p-3 text-sm leading-6 text-muted-foreground">
              {item.whyInteresting ? <p>{item.whyInteresting}</p> : null}
              {item.recommendedAction ? <p>{item.recommendedAction}</p> : null}
            </section>
          ) : null}
          {scoreComponents.length ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">Score components</h2>
              <div className="flex flex-wrap gap-2">
                {scoreComponents.map(([key, value]) => (
                  <Badge key={key} variant="outline">
                    {formatScoreComponentLabel(key)}: {String(value)}
                  </Badge>
                ))}
              </div>
            </section>
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
