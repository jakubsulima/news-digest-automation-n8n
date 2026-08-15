import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:h-16 sm:px-6">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-col px-4 md:gap-4 md:px-6 md:py-6">
        <section className="-mx-4 grid min-h-17 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-y px-4 py-3 md:mx-0 md:rounded-xl md:border">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-2.5 shrink-0 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-10 w-32 rounded-lg" />
        </section>

        <section className="-mx-4 overflow-hidden bg-background md:mx-0 md:rounded-2xl md:border md:bg-card">
          <div className="border-b px-4 py-4 md:px-5 md:py-5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <Skeleton className="h-6 w-44" />
              <Skeleton className="ml-auto h-4 w-12" />
            </div>
            <div className="mt-4 grid gap-3">
              {["w-full", "w-11/12", "w-10/12", "w-9/12"].map((width, index) => (
                <div key={index} className="flex items-start gap-3">
                  <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
                  <Skeleton className={`h-9 ${width}`} />
                </div>
              ))}
            </div>
          </div>
          <div className="px-4 pb-2 pt-4 md:px-5">
            <Skeleton className="h-6 w-32" />
          </div>
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid grid-cols-[1fr_auto] gap-3 border-t px-4 py-3 md:px-5 md:py-4">
              <div className="grid min-w-0 gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-10/12" />
              </div>
              <Skeleton className="size-7 self-center rounded-lg" />
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
