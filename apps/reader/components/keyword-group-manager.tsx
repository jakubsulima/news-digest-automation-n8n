"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type KeywordGroup = {
  description: string;
  id: string;
  keywords: readonly string[];
  label: string;
};

type Sentiment = "prefer" | "avoid";
type KeywordGroupWithDefault = KeywordGroup & {
  defaultSentiment: Sentiment;
};

const SWIPE_THRESHOLD_PX = 36;
const SWIPE_PREVIEW_LIMIT_PX = 72;

function uniqueKeywords(groupKeywords: readonly string[]) {
  const seen = new Set<string>();

  return groupKeywords.filter((keyword) => {
    const normalized = keyword.trim().toLowerCase();

    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

export function KeywordGroupManager({
  activeAvoidGroupIds,
  activePreferGroupIds,
  avoidGroups,
  preferGroups,
}: {
  activeAvoidGroupIds: readonly string[];
  activePreferGroupIds: readonly string[];
  avoidGroups: readonly KeywordGroup[];
  preferGroups: readonly KeywordGroup[];
}) {
  const groups = useMemo<KeywordGroupWithDefault[]>(
    () => [
      ...preferGroups.map((group) => ({ ...group, defaultSentiment: "prefer" as const })),
      ...avoidGroups.map((group) => ({ ...group, defaultSentiment: "avoid" as const })),
    ],
    [avoidGroups, preferGroups],
  );
  const pointerStartX = useRef<Record<string, number>>({});
  const [dragOffsets, setDragOffsets] = useState<Record<string, number>>({});
  const [sentiments, setSentiments] = useState<Record<string, Sentiment>>(() =>
    Object.fromEntries(
      groups.map((group) => [
        group.id,
        activePreferGroupIds.includes(group.id)
          ? "prefer"
          : activeAvoidGroupIds.includes(group.id)
            ? "avoid"
            : group.defaultSentiment,
      ]),
    ),
  );

  function setSentiment(groupId: string, sentiment: Sentiment) {
    setSentiments((current) => ({
      ...current,
      [groupId]: sentiment,
    }));
  }

  function setDragOffset(groupId: string, offset: number) {
    setDragOffsets((current) => ({
      ...current,
      [groupId]: offset,
    }));
  }

  function clearDrag(groupId: string) {
    delete pointerStartX.current[groupId];
    setDragOffsets((current) => {
      const next = { ...current };
      delete next[groupId];
      return next;
    });
  }

  function keywordsFor(sentiment: Sentiment) {
    return uniqueKeywords(
      groups
        .filter((group) => sentiments[group.id] === sentiment)
        .flatMap((group) => group.keywords),
    );
  }

  const preferKeywords = keywordsFor("prefer");
  const avoidKeywords = keywordsFor("avoid");

  return (
    <div className="grid gap-3">
      <input type="hidden" name="preferredKeywords" value={preferKeywords.join(", ")} />
      <input type="hidden" name="excludedKeywords" value={avoidKeywords.join(", ")} />

      <p className="text-xs text-muted-foreground sm:hidden">Swipe right to like. Swipe left to dislike.</p>

      <div className="grid gap-2">
        {groups.map((group) => {
          const sentiment = sentiments[group.id];
          const dragOffset = dragOffsets[group.id] ?? 0;
          const previewSentiment =
            dragOffset > 12 ? "prefer" : dragOffset < -12 ? "avoid" : sentiment;
          const liked = previewSentiment === "prefer";

          return (
            <div
              key={group.id}
              className={cn(
                "grid touch-pan-y select-none gap-2 rounded-lg border px-3 py-2 transition-colors sm:grid-cols-[1fr_auto] sm:items-center",
                liked
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-rose-500/30 bg-rose-500/10",
              )}
              style={{
                transform: dragOffset ? `translateX(${dragOffset}px)` : undefined,
                transition: dragOffset ? "background-color 150ms, border-color 150ms" : undefined,
              }}
              onPointerDown={(event) => {
                pointerStartX.current[group.id] = event.clientX;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const startX = pointerStartX.current[group.id];

                if (typeof startX !== "number") {
                  return;
                }

                const deltaX = event.clientX - startX;
                const clampedOffset = Math.max(
                  -SWIPE_PREVIEW_LIMIT_PX,
                  Math.min(SWIPE_PREVIEW_LIMIT_PX, deltaX),
                );

                setDragOffset(group.id, clampedOffset);
              }}
              onPointerUp={(event) => {
                const startX = pointerStartX.current[group.id];
                const deltaX = typeof startX === "number" ? event.clientX - startX : 0;

                if (deltaX > SWIPE_THRESHOLD_PX) {
                  setSentiment(group.id, "prefer");
                }
                if (deltaX < -SWIPE_THRESHOLD_PX) {
                  setSentiment(group.id, "avoid");
                }
                clearDrag(group.id);
              }}
              onPointerCancel={() => {
                clearDrag(group.id);
              }}
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3 sm:justify-start">
                  <h3 className="truncate text-sm font-semibold">{group.label}</h3>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                      liked
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                    )}
                  >
                    {liked ? "Like" : "Dislike"}
                  </span>
                </div>
                <p className="mt-1 hidden truncate text-xs text-muted-foreground sm:block">
                  {group.description}
                </p>
              </div>

              <div className="hidden grid-cols-2 gap-1 sm:grid sm:w-40">
                <Button
                  type="button"
                  variant={sentiment === "avoid" ? "destructive" : "outline"}
                  size="sm"
                  aria-pressed={sentiment === "avoid"}
                  onClick={() => setSentiment(group.id, "avoid")}
                >
                  <ThumbsDown aria-hidden="true" />
                  Dislike
                </Button>
                <Button
                  type="button"
                  variant={sentiment === "prefer" ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={sentiment === "prefer"}
                  onClick={() => setSentiment(group.id, "prefer")}
                >
                  <ThumbsUp aria-hidden="true" />
                  Like
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
