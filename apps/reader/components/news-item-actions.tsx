"use client";

import { useRouter } from "next/navigation";
import { Archive, Bookmark, Check, Eye, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type NewsItemActionsProps = {
  itemId: string;
  isRead: boolean;
  isSaved: boolean;
  isArchived: boolean;
  onArchivedChange?: (archived: boolean) => void;
};

type ItemAction = "archived" | "read" | "saved";
type ItemActionState = {
  archived: boolean;
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

export function NewsItemActions({ itemId, isRead, isSaved, isArchived, onArchivedChange }: NewsItemActionsProps) {
  const router = useRouter();
  const [state, setState] = useState<ItemActionState>({
    archived: isArchived,
    read: isRead,
    saved: isSaved,
  });
  const [pendingAction, setPendingAction] = useState<ItemAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateItemState(action: ItemAction) {
    if (pendingAction) {
      return;
    }

    const enabled = !state[action];
    const previousState = state;

    setError(null);
    setPendingAction(action);
    setState({ ...state, [action]: enabled });

    if (action === "archived") {
      onArchivedChange?.(enabled);
    }

    try {
      const response = await apiAction(action, enabled, itemId);
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not update item.");
      }

      router.refresh();
    } catch (updateError) {
      setState(previousState);
      if (action === "archived") {
        onArchivedChange?.(previousState.archived);
      }
      setError(updateError instanceof Error ? updateError.message : "Could not update item.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon-lg"
        type="button"
        title="Toggle read"
        aria-label="Toggle read"
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
      </Button>
      <Button
        variant="outline"
        size="icon-lg"
        type="button"
        title="Toggle saved"
        aria-label="Toggle saved"
        disabled={pendingAction !== null}
        onClick={() => void updateItemState("saved")}
      >
        {pendingAction === "saved" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Bookmark fill={state.saved ? "currentColor" : "none"} aria-hidden="true" />
        )}
      </Button>
      <Button
        variant="outline"
        size="icon-lg"
        type="button"
        title="Archive"
        aria-label="Archive"
        disabled={pendingAction !== null}
        onClick={() => void updateItemState("archived")}
      >
        {pendingAction === "archived" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Archive aria-hidden="true" />
        )}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
