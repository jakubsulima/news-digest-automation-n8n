import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import type { RankedNewsItem } from "@/lib/reader-feed-ranking";
import { NewsItemCard } from "@/components/news-item-card";

type NewsFeedSectionProps = {
  items: RankedNewsItem[];
  label: string;
  onFeedbackChange: (itemId: string, feedback: FeedbackSentiment | null, reason: FeedbackReason | null) => void;
  onFastRead: (item: RankedNewsItem, rank: number) => void;
  onItemStateChange: (
    itemId: string,
    state: Pick<RankedNewsItem, "archivedAt" | "readAt" | "savedAt">,
  ) => void;
  onSourceOpen: (item: RankedNewsItem, rank: number) => void;
  rankOffset: number;
};

export function NewsFeedSection({
  items,
  label,
  onFeedbackChange,
  onFastRead,
  onItemStateChange,
  onSourceOpen,
  rankOffset,
}: NewsFeedSectionProps) {
  if (!items.length) return null;

  return (
    <section className="grid gap-2" aria-label={label}>
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      {items.map((item, index) => {
        const rank = rankOffset + index;
        return (
          <NewsItemCard
            key={item.id}
            density="compact"
            item={item}
            onFastRead={() => onFastRead(item, rank)}
            onFeedbackChange={onFeedbackChange}
            onItemStateChange={onItemStateChange}
            onSourceOpen={() => onSourceOpen(item, rank)}
          />
        );
      })}
    </section>
  );
}
