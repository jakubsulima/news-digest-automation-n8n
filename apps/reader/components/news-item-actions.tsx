import { Archive, Bookmark, Check, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toggleArchived, toggleRead, toggleSaved } from "@/lib/actions";

type NewsItemActionsProps = {
  itemId: string;
  isRead: boolean;
  isSaved: boolean;
  isArchived: boolean;
};

export function NewsItemActions({ itemId, isRead, isSaved, isArchived }: NewsItemActionsProps) {
  return (
    <>
      <form action={toggleRead.bind(null, itemId, isRead)}>
        <Button variant="outline" size="icon-lg" type="submit" title="Toggle read" aria-label="Toggle read">
          {isRead ? <Check aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </form>
      <form action={toggleSaved.bind(null, itemId, isSaved)}>
        <Button variant="outline" size="icon-lg" type="submit" title="Toggle saved" aria-label="Toggle saved">
          <Bookmark fill={isSaved ? "currentColor" : "none"} aria-hidden="true" />
        </Button>
      </form>
      <form action={toggleArchived.bind(null, itemId, isArchived)}>
        <Button variant="outline" size="icon-lg" type="submit" title="Archive" aria-label="Archive">
          <Archive aria-hidden="true" />
        </Button>
      </form>
    </>
  );
}
