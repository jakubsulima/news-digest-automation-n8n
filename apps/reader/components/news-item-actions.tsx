"use client";

import { Bookmark, Check, Eye, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocalize } from "@/components/reader-locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NewsItemActionsProps = {
  buttonClassName?: string;
  buttonSize?: "sm" | "icon-sm" | "icon-lg" | "lg";
  className?: string;
  itemId: string;
  isRead: boolean;
  isSaved: boolean;
  onStateChange?: (state: ItemActionState) => void;
  showLabels?: boolean;
};

type ItemAction = "read" | "saved";
type ItemActionState = {
  read: boolean;
  saved: boolean;
};

function apiAction(action: ItemAction, enabled: boolean, itemId: string) {
  return fetch(`/api/news-items/${itemId}/state`, {
    body: JSON.stringify({ action, enabled }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
}

export function NewsItemActions({
  buttonClassName,
  buttonSize = "icon-lg",
  className,
  itemId,
  isRead,
  isSaved,
  onStateChange,
  showLabels = false,
}: NewsItemActionsProps) {
  const l = useLocalize();
  const propState: ItemActionState = {
    read: isRead,
    saved: isSaved,
  };
  const [localState, setLocalState] = useState(propState);
  const [pendingAction, setPendingAction] = useState<ItemAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = onStateChange ? propState : localState;

  useEffect(() => {
    if (!onStateChange) {
      setLocalState({
        read: isRead,
        saved: isSaved,
      });
    }
  }, [isRead, isSaved, onStateChange]);

  function applyState(nextState: ItemActionState) {
    if (onStateChange) {
      onStateChange(nextState);
      return;
    }

    setLocalState(nextState);
  }

  async function updateItemState(action: ItemAction) {
    if (pendingAction) {
      return;
    }

    const enabled = !state[action];
    const previousState = state;

    setError(null);
    setPendingAction(action);
    applyState({ ...state, [action]: enabled });

    try {
      const response = await apiAction(action, enabled, itemId);
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || l("Nie udało się zaktualizować newsa.", "Could not update the story."));
      }
    } catch (updateError) {
      applyState(previousState);
      setError(updateError instanceof Error ? updateError.message : l("Nie udało się zaktualizować newsa.", "Could not update the story."));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button
        variant="outline"
        size={buttonSize}
        className={buttonClassName}
        type="button"
        title={state.read ? l("Oznacz jako nieprzeczytane", "Mark as unread") : l("Oznacz jako przeczytane", "Mark as read")}
        aria-label={state.read ? l("Oznacz jako nieprzeczytane", "Mark as unread") : l("Oznacz jako przeczytane", "Mark as read")}
        disabled={pendingAction !== null}
        onClick={() => void updateItemState("read")}
      >
        {pendingAction === "read" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : state.read ? (
          <Check aria-hidden="true" />
        ) : (
          <Eye aria-hidden="true" />
        )}
        {showLabels ? <span>{state.read ? l("Przeczytane", "Read") : l("Oznacz jako przeczytane", "Mark as read")}</span> : null}
      </Button>
      <Button
        variant="outline"
        size={buttonSize}
        className={buttonClassName}
        type="button"
        title={state.saved ? l("Usuń z zapisanych", "Remove from saved") : l("Zapisz", "Save")}
        aria-label={state.saved ? l("Usuń z zapisanych", "Remove from saved") : l("Zapisz", "Save")}
        disabled={pendingAction !== null}
        onClick={() => void updateItemState("saved")}
      >
        {pendingAction === "saved" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Bookmark fill={state.saved ? "currentColor" : "none"} aria-hidden="true" />
        )}
        {showLabels ? <span>{state.saved ? l("Zapisano", "Saved") : l("Zapisz", "Save")}</span> : null}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
