import { RotateCcw } from "lucide-react";

import { AppNavbar } from "@/components/app-navbar";
import { Button } from "@/components/ui/button";
import { DigestRunPanel } from "@/components/digest-run-panel";
import { DigestBriefCard } from "@/components/digest-brief";
import { NewsFeed } from "@/components/news-feed";
import { retryDigestRun } from "@/lib/actions";
import { requireCurrentReader } from "@/lib/auth";
import { getDigestRunStatus } from "@/lib/digest-runs";
import { fallbackDigestBriefFromNews, getLatestDigestBrief } from "@/lib/digest-brief";
import { normalizeReaderFeedId } from "@/lib/feed-categories";
import { normalizeReaderViewId } from "@/lib/reader-feed-filters";
import { getReaderFeedPage } from "@/lib/reader-feed";
import { normalizeFeedPeriod, normalizeFeedSort } from "@/lib/reader-feed-ranking";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    feed?: string | string[];
    period?: string | string[];
    sort?: string | string[];
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
  const requestedView = normalizeReaderViewId(params?.view);
  const activeView = requestedView === "archived" ? "all" : requestedView;
  const activeSort = normalizeFeedSort(Array.isArray(params?.sort) ? params.sort[0] : params?.sort);
  const activePeriod = normalizeFeedPeriod(Array.isArray(params?.period) ? params.period[0] : params?.period);
  const user = await requireCurrentReader();
  const [feedPage, digestRun, digestBrief] = await Promise.all([
    getReaderFeedPage(user.id, {
      feed: activeFeed,
      period: activePeriod,
      sort: activeSort,
      view: activeView,
    }),
    getDigestRunStatus(),
    getLatestDigestBrief(),
  ]);
  const allInitialItems = Object.values(feedPage.grouped).flat();
  const brief = digestBrief || fallbackDigestBriefFromNews(allInitialItems);

  return (
    <>
      <AppNavbar email={user.email || "Reader"} signOut={signOut} />
      <main
        id="page-top"
        className="mx-auto flex w-full max-w-5xl scroll-mt-20 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6"
      >
        <NewsFeed
          briefingSlot={brief ? <DigestBriefCard key="digest-brief" brief={brief} /> : null}
          initialFeed={activeFeed}
          initialPage={feedPage}
          initialPeriod={activePeriod}
          initialSort={activeSort}
          initialView={activeView}
          digestSlot={
            <DigestRunPanel
              key="digest-run"
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
    </>
  );
}
