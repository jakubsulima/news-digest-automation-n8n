import { Inbox, LogOut, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DigestRunPanel } from "@/components/digest-run-panel";
import { NewsItemCard } from "@/components/news-item-card";
import { retryDigestRun } from "@/lib/actions";
import { requireCurrentReader } from "@/lib/auth";
import { getDigestRunStatus } from "@/lib/digest-runs";
import { getReaderNewsItems } from "@/lib/news";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
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
          {visibleItems.map((item) => (
            <NewsItemCard key={item.id} item={item} />
          ))}
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
