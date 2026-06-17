import { ExternalLink, Inbox, LogOut, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DigestRunPanel } from "@/components/digest-run-panel";
import { NewsItemActions } from "@/components/news-item-actions";
import { retryDigestRun } from "@/lib/actions";
import { requireCurrentReader } from "@/lib/auth";
import { getDigestRunStatus } from "@/lib/digest-runs";
import { getReaderNewsItems } from "@/lib/news";
import { createSupabaseServerClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
  }).format(new Date(value));
}

export default async function HomePage() {
  const user = await requireCurrentReader();
  const [items, digestRun] = await Promise.all([getReaderNewsItems(user.id), getDigestRunStatus()]);
  const visibleItems = items.filter((item) => !item.archivedAt);
  const unreadCount = visibleItems.filter((item) => !item.readAt).length;
  const savedCount = visibleItems.filter((item) => item.savedAt).length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight tracking-normal sm:text-2xl">
            Daily News Digest
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
        <form action={signOut}>
          <Button variant="outline" size="icon-lg" type="submit" title="Sign out" aria-label="Sign out">
            <LogOut aria-hidden="true" />
          </Button>
        </form>
      </header>

      <section className="grid gap-2 sm:grid-cols-3" aria-label="Feed stats">
        {[
          ["In feed", visibleItems.length],
          ["Unread", unreadCount],
          ["Saved", savedCount],
        ].map(([label, value]) => (
          <Card key={label} size="sm" className="bg-card/80">
            <CardContent className="grid gap-1">
              <span className="text-xl font-semibold tabular-nums">{value}</span>
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <DigestRunPanel
        initialRun={digestRun}
        retrySlot={
          digestRun?.status === "failed" ? (
            <form action={retryDigestRun.bind(null, digestRun.id)}>
              <Button type="submit" size="lg" title="Retry failed stage">
                <RotateCcw aria-hidden="true" />
                Retry failed stage
              </Button>
            </form>
          ) : null
        }
      />

      {visibleItems.length ? (
        <section className="grid gap-3" aria-label="News feed">
          {visibleItems.map((item) => {
            const isRead = Boolean(item.readAt);
            const isSaved = Boolean(item.savedAt);
            const isArchived = Boolean(item.archivedAt);

            return (
              <Card key={item.id} className={cn(isRead && "bg-card/70", isArchived && "opacity-60")}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="bg-accent text-accent-foreground">
                      {item.category}
                    </Badge>
                    <span>{item.source}</span>
                    <span>{formatDate(item.publishedAt || item.digestDate)}</span>
                    {item.importanceScore === null ? null : (
                      <Badge variant="outline">{item.importanceScore}</Badge>
                    )}
                  </div>

                  <CardTitle className="text-base leading-snug sm:text-lg">
                    <Link className="hover:underline" href={`/news/${item.id}`}>
                      {item.title}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <p className="text-sm leading-6 text-muted-foreground">{item.summary}</p>

                  <div className="flex flex-wrap items-center gap-2">
                    <NewsItemActions itemId={item.id} isRead={isRead} isSaved={isSaved} isArchived={isArchived} />
                    <a
                      className={buttonVariants({ variant: "outline", size: "lg" })}
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink aria-hidden="true" />
                      Source
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 text-muted-foreground">
            <Inbox className="size-5" aria-hidden="true" />
            <p className="text-sm">No items yet.</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
