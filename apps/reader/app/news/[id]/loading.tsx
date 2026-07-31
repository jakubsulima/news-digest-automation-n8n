import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="grid flex-1 gap-2 pt-0.5">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </div>
      </header>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card/80 p-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-7 w-11/12" />
            <Skeleton className="h-7 w-8/12" />
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-7/12" />
          </div>
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
    </main>
  );
}
