import Link from "next/link";
import { LogOut, RotateCcw, Settings } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { DigestRunPanel } from "@/components/digest-run-panel";
import { DigestBriefCard } from "@/components/digest-brief";
import { NewsFeed } from "@/components/news-feed";
import { ThemeToggle } from "@/components/theme-toggle";
import { retryDigestRun } from "@/lib/actions";
import { requireCurrentReader } from "@/lib/auth";
import { getDigestRunStatus } from "@/lib/digest-runs";
import { fallbackDigestBriefFromNews, getLatestDigestBrief } from "@/lib/digest-brief";
import { normalizeReaderFeedId } from "@/lib/feed-categories";
import { normalizeReaderViewId } from "@/lib/reader-feed-filters";
import { getReaderNewsItems } from "@/lib/news";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    feed?: string | string[];
    view?: string | string[];
  }>;
};

async function signOut() {
  "use server";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const activeFeed = normalizeReaderFeedId(params?.feed);
  const activeView = normalizeReaderViewId(params?.view);
  const user = await requireCurrentReader();
  const [items, digestRun, digestBrief] = await Promise.all([
    getReaderNewsItems(user.id),
    getDigestRunStatus(),
    getLatestDigestBrief(),
  ]);
  const brief = digestBrief || fallbackDigestBriefFromNews(items);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight tracking-normal sm:text-2xl">
            Daily News Digest
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <Link
            className={buttonVariants({ variant: "outline", size: "icon-lg" })}
            href="/settings"
            title="Settings"
            aria-label="Settings"
          >
            <Settings aria-hidden="true" />
          </Link>
          <form action={signOut}>
            <Button variant="outline" size="icon-lg" type="submit" title="Sign out" aria-label="Sign out">
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
      </header>

      <NewsFeed
        briefingSlot={brief ? <DigestBriefCard brief={brief} /> : null}
        initialFeed={activeFeed}
        initialItems={items}
        initialView={activeView}
        digestSlot={
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
        }
      />
    </main>
  );
}
