import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function NewsCardSkeleton() {
  return (
    <Card
      size="sm"
      className="-mx-4 rounded-none bg-transparent py-0 shadow-none ring-0 md:mx-0 md:rounded-xl md:bg-card md:py-3 md:shadow-sm md:ring-foreground/8"
    >
      <CardHeader className="gap-2 px-4 pb-1 pt-4 md:pt-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="size-9 shrink-0 rounded-lg" />
        </div>
        <div className="grid gap-1.5">
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-7/12" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-1.5 px-4 pb-4 md:pb-0">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-8/12" />
        <div className="mt-2 hidden items-center justify-between border-t pt-2.5 md:flex">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}
