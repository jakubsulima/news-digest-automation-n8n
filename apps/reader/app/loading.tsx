import { NewsCardSkeleton } from "@/components/news-card-skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function StatSkeleton() {
  return (
    <Card size="sm" className="bg-card/80">
      <CardContent className="grid gap-2">
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="size-10" />
      </header>

      <section className="grid gap-2 sm:grid-cols-3" aria-label="Loading feed stats">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Loading category feeds">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-24" />
        ))}
      </nav>

      <section className="overflow-hidden border-y py-4" aria-label="Loading digest run">
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3" aria-label="Loading news feed">
        <NewsCardSkeleton />
        <NewsCardSkeleton />
        <NewsCardSkeleton />
      </section>
    </main>
  );
}
