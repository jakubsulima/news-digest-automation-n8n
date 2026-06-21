import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemFeedbackActions } from "@/components/news-item-feedback-actions";
import { NewsItemActions } from "@/components/news-item-actions";
import { requireCurrentReader } from "@/lib/auth";
import { getReaderNewsItem } from "@/lib/news";

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
          <NewsItemFeedbackActions itemId={item.id} feedback={item.feedback} />
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="bg-accent text-accent-foreground">
              {item.category}
            </Badge>
            <span>{item.source}</span>
            <span>{formatDate(item.publishedAt)}</span>
            {item.importanceScore === null ? null : <Badge variant="outline">{item.importanceScore}</Badge>}
          </div>

          <CardTitle className="text-xl leading-tight sm:text-2xl">
            <a className="hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{item.summary}</p>

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
