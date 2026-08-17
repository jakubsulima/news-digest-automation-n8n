"use client";

import { useEffect, useState } from "react";

import {
  NEWS_LIST_HREF_EVENT,
  rememberedNewsListHref,
} from "@/lib/news-navigation";

export function useRememberedNewsHref() {
  const [href, setHref] = useState("/news");

  useEffect(() => {
    setHref(rememberedNewsListHref());

    function handleHrefChange(event: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setHref(event.detail);
      }
    }

    window.addEventListener(NEWS_LIST_HREF_EVENT, handleHrefChange);
    return () => window.removeEventListener(NEWS_LIST_HREF_EVENT, handleHrefChange);
  }, []);

  return href;
}
