"use client";

import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import { cn } from "@/lib/utils";

type NewsItemFeedbackActionsProps = {
  buttonClassName?: string;
  buttonSize?: "sm" | "icon-sm" | "icon-lg" | "lg";
  className?: string;
  itemId: string;
  feedback: FeedbackSentiment | null;
  feedbackReason?: FeedbackReason | null;
  showLabels?: boolean;
  onFeedbackChange?: (feedback: FeedbackSentiment | null, reason: FeedbackReason | null) => void;
};

async function apiFeedback(itemId: string, sentiment: FeedbackSentiment | null, reason: FeedbackReason) {
  return fetch(`/api/news-items/${itemId}/feedback`, {
    body: JSON.stringify({ reason, sentiment }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
}

export function NewsItemFeedbackActions({
  buttonClassName,
  buttonSize = "icon-lg",
  className,
  itemId,
  feedback,
  feedbackReason = null,
  showLabels = false,
  onFeedbackChange,
}: NewsItemFeedbackActionsProps) {
  const [localFeedback, setLocalFeedback] = useState(feedback);
  const [localReason, setLocalReason] = useState<FeedbackReason | null>(feedbackReason);
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackSentiment | null>(null);
  const [reasonMenuOpen, setReasonMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeFeedback = onFeedbackChange ? feedback : localFeedback;
  const activeReason = onFeedbackChange ? feedbackReason : localReason;

  useEffect(() => {
    if (!onFeedbackChange) {
      setLocalFeedback(feedback);
      setLocalReason(feedbackReason);
    }
  }, [feedback, feedbackReason, onFeedbackChange]);

  function applyFeedback(nextFeedback: FeedbackSentiment | null, reason: FeedbackReason | null) {
    if (onFeedbackChange) {
      onFeedbackChange(nextFeedback, reason);
      return;
    }

    setLocalFeedback(nextFeedback);
    setLocalReason(reason);
  }

  async function updateFeedback(sentiment: FeedbackSentiment | null, reason: FeedbackReason = "topic") {
    if (pendingFeedback) {
      return;
    }

    const nextFeedback = sentiment;
    const previousFeedback = activeFeedback;
    const previousReason = activeReason;

    setError(null);
    setPendingFeedback(sentiment || activeFeedback || "less");
    setReasonMenuOpen(false);
    applyFeedback(nextFeedback, nextFeedback ? reason : null);

    try {
      const response = await apiFeedback(itemId, nextFeedback, reason);
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not update feedback.");
      }
    } catch (updateError) {
      applyFeedback(previousFeedback, previousReason);
      setError(updateError instanceof Error ? updateError.message : "Could not update feedback.");
    } finally {
      setPendingFeedback(null);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Button
        variant={activeFeedback === "more" ? "secondary" : "outline"}
        size={buttonSize}
        className={buttonClassName}
        type="button"
        title="More like this"
        aria-label="More like this"
        disabled={pendingFeedback !== null}
        onClick={() => void updateFeedback(activeFeedback === "more" ? null : "more", "topic")}
      >
        {pendingFeedback === "more" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ThumbsUp aria-hidden="true" />}
        {showLabels ? <span>More</span> : null}
      </Button>
      <Button
        variant={activeFeedback === "less" ? "destructive" : "outline"}
        size={buttonSize}
        className={buttonClassName}
        type="button"
        title="Less like this"
        aria-label="Less like this"
        disabled={pendingFeedback !== null}
        onClick={() => activeFeedback === "less" ? void updateFeedback(null, activeReason || "topic") : setReasonMenuOpen((value) => !value)}
      >
        {pendingFeedback === "less" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ThumbsDown aria-hidden="true" />
        )}
        {showLabels ? <span>Less</span> : null}
      </Button>
      {activeFeedback === "more" ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="What should be preferred?">
          <Button
            variant={activeReason === "source" ? "secondary" : "ghost"}
            size="sm"
            type="button"
            disabled={pendingFeedback !== null}
            onClick={() => void updateFeedback("more", "source")}
          >
            Prefer source
          </Button>
          <Button
            variant={activeReason === "entity" ? "secondary" : "ghost"}
            size="sm"
            type="button"
            disabled={pendingFeedback !== null}
            onClick={() => void updateFeedback("more", "entity")}
          >
            Prefer entity
          </Button>
        </div>
      ) : null}
      {reasonMenuOpen ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Why show fewer stories like this?">
          {([
            ["topic", "Topic"],
            ["entity", "Entity"],
            ["source", "Source"],
            ["repetitive", "Repetitive"],
            ["quality", "Poor quality"],
          ] as const).map(([reason, label]) => (
            <Button key={reason} type="button" size="sm" variant="outline" onClick={() => void updateFeedback("less", reason)}>
              {label}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
