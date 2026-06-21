"use client";

import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FeedbackSentiment } from "@/lib/reader-feedback";

type NewsItemFeedbackActionsProps = {
  itemId: string;
  feedback: FeedbackSentiment | null;
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

export function NewsItemFeedbackActions({ itemId, feedback, onFeedbackChange }: NewsItemFeedbackActionsProps) {
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
    <>
      <Button
        variant={activeFeedback === "more" ? "secondary" : "outline"}
        size="icon-lg"
        type="button"
        title="More like this"
        aria-label="More like this"
        disabled={pendingFeedback !== null}
        onClick={() => void updateFeedback("more")}
      >
        {pendingFeedback === "more" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ThumbsUp aria-hidden="true" />}
      </Button>
      <Button
        variant={activeFeedback === "less" ? "destructive" : "outline"}
        size="icon-lg"
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
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
