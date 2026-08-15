import { NewsCardSkeleton } from "@/components/news-card-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewsLoading() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:h-16 sm:px-6">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <header className="grid gap-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </header>
        <section className="sticky top-14 z-30 -mx-4 grid gap-3 border-y bg-background/96 p-3 backdrop-blur-xl md:static md:mx-0 md:rounded-2xl md:border md:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="grid gap-1.5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
        </section>
        <section className="grid gap-0 md:gap-3" aria-label="Ładowanie newsów">
          <div className="-mx-4 flex items-center justify-between border-y px-4 py-3 md:mx-0 md:border-0 md:px-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-5" />
          </div>
          <NewsCardSkeleton />
          <NewsCardSkeleton />
          <NewsCardSkeleton />
        </section>
      </main>
    </>
  );
}
