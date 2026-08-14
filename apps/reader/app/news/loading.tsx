import { NewsCardSkeleton } from "@/components/news-card-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewsLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="grid gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-64" />
      </header>
      <Skeleton className="h-44 w-full rounded-2xl" />
      <section className="grid gap-3" aria-label="Ładowanie newsów">
        <NewsCardSkeleton />
        <NewsCardSkeleton />
        <NewsCardSkeleton />
      </section>
    </main>
  );
}
