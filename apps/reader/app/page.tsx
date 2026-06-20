import { LogOut, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DigestRunPanel } from "@/components/digest-run-panel";
import { NewsFeed } from "@/components/news-feed";
import { retryDigestRun } from "@/lib/actions";
import { requireCurrentReader } from "@/lib/auth";
import { getDigestRunStatus } from "@/lib/digest-runs";
import { normalizeReaderFeedId } from "@/lib/feed-categories";
import { getReaderNewsItems } from "@/lib/news";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    feed?: string | string[];
  }>;
};

async function signOut() {
  "use server";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const activeFeed = normalizeReaderFeedId((await searchParams)?.feed);
  const user = await requireCurrentReader();
  const [items, digestRun] = await Promise.all([getReaderNewsItems(user.id), getDigestRunStatus()]);

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

      <NewsFeed
        initialFeed={activeFeed}
        initialItems={items}
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
