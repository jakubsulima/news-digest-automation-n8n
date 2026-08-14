import { RotateCcw } from "lucide-react";

import { AppNavbar } from "@/components/app-navbar";
import { Button } from "@/components/ui/button";
import { DigestRunPanel } from "@/components/digest-run-panel";
import { DigestBriefCard } from "@/components/digest-brief";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { retryDigestRun } from "@/lib/actions";
import { requireCurrentReader } from "@/lib/auth";
import { getDigestRunStatus } from "@/lib/digest-runs";
import { fallbackDigestBriefFromNews, getLatestDigestBrief } from "@/lib/digest-brief";
import { getReaderFeedPage } from "@/lib/reader-feed";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

export default async function HomePage() {
  const user = await requireCurrentReader();
  const [digestRun, digestBrief, feedPage] = await Promise.all([
    getDigestRunStatus(),
    getLatestDigestBrief(),
    getReaderFeedPage(user.id, {
      feed: "all",
      period: "latest",
      sort: "for-you",
      view: "all",
    }),
  ]);
  const allInitialItems = Object.values(feedPage.grouped).flat();
  const brief = digestBrief || fallbackDigestBriefFromNews(
    allInitialItems,
  );
  const digestDateLabel = brief
    ? new Intl.DateTimeFormat("pl-PL", {
        day: "numeric",
        month: "long",
        timeZone: "Europe/Warsaw",
        year: "numeric",
      }).format(new Date(`${brief.digestDate}T12:00:00Z`))
    : "Dzisiaj";

  return (
    <>
      <AppNavbar email={user.email || "Reader"} mobileContext={digestDateLabel} signOut={signOut} />
      <main
        id="page-top"
        className="mx-auto flex w-full max-w-4xl scroll-mt-20 flex-col gap-0 px-4 md:gap-4 md:px-6 md:py-6"
      >
        <DigestRunPanel
          initialRun={digestRun}
          storyCount={feedPage.totalCount}
          retrySlot={
            digestRun?.status === "failed" ? (
              <form action={retryDigestRun.bind(null, digestRun.id)}>
                <Button type="submit" size="lg" title="Ponów nieudany etap">
                  <RotateCcw aria-hidden="true" />
                  Ponów etap
                </Button>
              </form>
            ) : null
          }
        />
        {brief ? <DigestBriefCard brief={brief} /> : null}
      </main>
      <MobileBottomNav />
    </>
  );
}
