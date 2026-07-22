import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotebookLoading() {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-5 sm:px-6 sm:py-7">
      <Skeleton className="h-12 w-56" />
      <Skeleton className="h-24 w-full" />
      {[0, 1, 2].map((index) => <Card key={index}><CardContent><Skeleton className="h-28 w-full" /></CardContent></Card>)}
    </main>
  );
}

