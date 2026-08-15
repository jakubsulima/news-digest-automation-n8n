import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SettingsCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Card className="border-border/70 bg-card/70 shadow-sm ring-0">
      <CardHeader className="gap-2 border-b border-border/60">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent className="grid gap-4">
        {Array.from({ length: rows }).map((_, index) => <Skeleton key={index} className="h-11 w-full rounded-lg" />)}
      </CardContent>
    </Card>
  );
}

export default function SettingsLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="grid min-w-0 flex-1 gap-2 pt-0.5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/30 p-1">
        {[0, 1, 2].map((index) => <Skeleton key={index} className="h-10 w-full" />)}
      </div>

      <Card className="border-border/70 bg-card/70 shadow-sm ring-0">
        <CardHeader className="gap-2 border-b border-border/60">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
          <Skeleton className="h-11 w-full rounded-lg md:hidden" />
        </CardContent>
      </Card>

      <Skeleton className="h-17 w-full rounded-xl" />

      <SettingsCardSkeleton rows={3} />
      <SettingsCardSkeleton rows={2} />
    </main>
  );
}
