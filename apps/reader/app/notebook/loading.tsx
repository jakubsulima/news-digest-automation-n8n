import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotebookLoading() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="grid flex-1 gap-2 pt-0.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </div>
      </header>
      <Card className="-mx-4 rounded-none border-y bg-card/60 shadow-none ring-0 md:mx-0 md:rounded-xl md:shadow-sm md:ring-1">
        <CardContent className="grid gap-3 p-4 md:p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-24" />
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-8 w-24 rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
      <Card className="border-dashed bg-card/60">
        <CardContent className="grid justify-items-center gap-3 py-12 text-center">
          <Skeleton className="size-12 rounded-full" />
          <div className="grid w-full max-w-xs justify-items-center gap-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-9/12" />
          </div>
          <Skeleton className="h-9 w-36 rounded-lg" />
        </CardContent>
      </Card>
    </main>
  );
}
