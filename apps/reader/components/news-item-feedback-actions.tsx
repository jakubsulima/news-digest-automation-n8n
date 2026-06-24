"use client";

import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FeedbackSentiment } from "@/lib/reader-feedback";
import { cn } from "@/lib/utils";

type NewsItemFeedbackActionsProps = {
  buttonClassName?: string;
  buttonSize?: "sm" | "icon-sm" | "icon-lg" | "lg";
  className?: string;
  itemId: string;
  feedback: FeedbackSentiment | null;
  showLabels?: boolean;
  onFeedbackChange?: (feedback: FeedbackSentiment | null) => void;
};

async function apiFeedback(itemId: string, sentiment: FeedbackSentiment | null) {
  return fetch(`/api/news-items/${itemId}/feedback`, {
    body: JSON.stringify({ sentiment }),
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
  showLabels = false,
  onFeedbackChange,
}: NewsItemFeedbackActionsProps) {
  const [localFeedback, setLocalFeedback] = useState(feedback);
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackSentiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeFeedback = onFeedbackChange ? feedback : localFeedback;

  useEffect(() => {
    if (!onFeedbackChange) {
      setLocalFeedback(feedback);
    }
  }, [feedback, onFeedbackChange]);

  function applyFeedback(nextFeedback: FeedbackSentiment | null) {
    if (onFeedbackChange) {
      onFeedbackChange(nextFeedback);
      return;
    }

    setLocalFeedback(nextFeedback);
  }

  async function updateFeedback(sentiment: FeedbackSentiment) {
    if (pendingFeedback) {
      return;
    }

    const nextFeedback = activeFeedback === sentiment ? null : sentiment;
    const previousFeedback = activeFeedback;

    setError(null);
    setPendingFeedback(sentiment);
    applyFeedback(nextFeedback);

    try {
      const response = await apiFeedback(itemId, nextFeedback);
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not update feedback.");
      }
    } catch (updateError) {
      applyFeedback(previousFeedback);
      setError(updateError instanceof Error ? updateError.message : "Could not update feedback.");
    } finally {
      setPendingFeedback(null);
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button
        variant={activeFeedback === "more" ? "secondary" : "outline"}
        size={buttonSize}
        className={buttonClassName}
        type="button"
        title="More like this"
        aria-label="More like this"
        disabled={pendingFeedback !== null}
        onClick={() => void updateFeedback("more")}
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
        onClick={() => void updateFeedback("less")}
      >
        {pendingFeedback === "less" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ThumbsDown aria-hidden="true" />
        )}
        {showLabels ? <span>Less</span> : null}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
