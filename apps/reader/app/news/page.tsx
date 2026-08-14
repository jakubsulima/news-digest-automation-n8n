import { AppNavbar } from "@/components/app-navbar";
import { NewsFeed } from "@/components/news-feed";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PageHeader } from "@/components/page-header";
import { requireCurrentReader } from "@/lib/auth";
import { normalizeReaderFeedId } from "@/lib/feed-categories";
import { normalizeReaderViewId } from "@/lib/reader-feed-filters";
import { getReaderFeedPage } from "@/lib/reader-feed";
import { normalizeFeedPeriod, normalizeFeedSort } from "@/lib/reader-feed-ranking";
import { localize } from "@/lib/reader-locale";
import { getReaderLocale } from "@/lib/reader-locale-server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type NewsPageProps = {
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

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const params = await searchParams;
  const activeFeed = normalizeReaderFeedId(params?.feed);
  const requestedView = normalizeReaderViewId(params?.view);
  const activeView = requestedView === "archived" ? "all" : requestedView;
  const activeSort = normalizeFeedSort(Array.isArray(params?.sort) ? params.sort[0] : params?.sort);
  const activePeriod = normalizeFeedPeriod(Array.isArray(params?.period) ? params.period[0] : params?.period);
  const user = await requireCurrentReader();
  const [feedPage, locale] = await Promise.all([getReaderFeedPage(user.id, {
    feed: activeFeed,
    period: activePeriod,
    sort: activeSort,
    view: activeView,
  }), getReaderLocale()]);

  return (
    <>
      <AppNavbar email={user.email || "Reader"} mobileContext={localize(locale, "Wszystkie newsy", "All news")} signOut={signOut} />
      <main
        id="page-top"
        className="mx-auto flex w-full max-w-5xl scroll-mt-20 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6"
      >
        <PageHeader
          backHref={null}
          title={localize(locale, "Wszystkie newsy", "All news")}
          description={localize(locale, `${feedPage.totalCount} materiałów w wybranym widoku.`, `${feedPage.totalCount} stories in the selected view.`)}
        />
        <NewsFeed
          initialFeed={activeFeed}
          initialPage={feedPage}
          initialPeriod={activePeriod}
          initialSort={activeSort}
          initialView={activeView}
        />
      </main>
      <MobileBottomNav />
    </>
  );
}
