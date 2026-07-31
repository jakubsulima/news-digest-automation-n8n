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
      <Card className="bg-card/80">
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-7 w-24" />)}
          </div>
        </CardContent>
      </Card>
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardContent className="grid gap-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
