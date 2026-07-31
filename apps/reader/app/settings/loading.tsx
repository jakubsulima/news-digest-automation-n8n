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

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-14 w-full" />
        </CardContent>
      </Card>

      <Skeleton className="h-16 w-full rounded-xl" />

      <SettingsCardSkeleton title="Digest presets" fields={5} />
      <SettingsCardSkeleton title="Output limits" fields={2} />
    </main>
  );
}
