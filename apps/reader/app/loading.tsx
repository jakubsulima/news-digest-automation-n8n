import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-5 sm:px-6 sm:py-7">
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </main>
  );
}
