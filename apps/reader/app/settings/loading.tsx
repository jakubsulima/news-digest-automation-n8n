import { ArrowLeft } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function FieldSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className={wide ? "h-20 w-full" : "h-8 w-full"} />
    </div>
  );
}

function SettingsCardSkeleton({ fields = 4, title }: { fields?: number; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: fields }).map((_, index) => (
            <FieldSkeleton key={index} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex items-center justify-between gap-4">
        <div className="inline-flex size-9 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </div>
        <div className="grid min-w-0 justify-items-end gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </header>

      <SettingsCardSkeleton title="Selection" fields={7} />

      <Card>
        <CardHeader>
          <CardTitle>Reading</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FieldSkeleton />
          <FieldSkeleton wide />
          <FieldSkeleton wide />
          <div className="flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-44" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="grid min-w-0 flex-1 gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
                <FieldSkeleton />
                <FieldSkeleton />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
