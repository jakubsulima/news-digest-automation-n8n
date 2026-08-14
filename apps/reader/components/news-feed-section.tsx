import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import type { RankedNewsItem } from "@/lib/reader-feed-ranking";
import { NewsItemCard } from "@/components/news-item-card";
import { RecommendationExposure } from "@/components/recommendation-exposure";

type NewsFeedSectionProps = {
  exposureContextId: string;
  items: RankedNewsItem[];
  label: string;
  onFeedbackChange: (itemId: string, feedback: FeedbackSentiment | null, reason: FeedbackReason | null) => void;
  onFastRead: (item: RankedNewsItem, rank: number) => void;
  onExposure: (item: RankedNewsItem, rank: number) => void;
  onItemStateChange: (
    itemId: string,
    state: Pick<RankedNewsItem, "archivedAt" | "readAt" | "savedAt">,
  ) => void;
  onSourceOpen: (item: RankedNewsItem, rank: number) => void;
  rankOffset: number;
};

export function NewsFeedSection({
  exposureContextId,
  items,
  label,
  onFeedbackChange,
  onFastRead,
  onExposure,
  onItemStateChange,
  onSourceOpen,
  rankOffset,
}: NewsFeedSectionProps) {
  if (!items.length) return null;

  return (
    <section className="-mx-4 grid gap-0 border-y bg-background md:mx-0 md:gap-2 md:border-0 md:bg-transparent" aria-label={label}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 md:border-0 md:px-1 md:py-0">
        <h2 className="text-base font-semibold md:text-sm">{label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      {items.map((item, index) => {
        const rank = rankOffset + index;
        return (
          <div key={`${exposureContextId}:${item.id}`} className="border-b last:border-b-0 md:border-0">
            <RecommendationExposure onExposure={() => onExposure(item, rank)}>
              <NewsItemCard
                density="compact"
                item={item}
                onFastRead={() => onFastRead(item, rank)}
                onFeedbackChange={onFeedbackChange}
                onItemStateChange={onItemStateChange}
                onSourceOpen={() => onSourceOpen(item, rank)}
              />
            </RecommendationExposure>
          </div>
        );
      })}
    </section>
  );
}
