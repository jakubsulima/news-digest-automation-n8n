"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { createExposureTracker } from "@/lib/exposure-tracker";

type RecommendationExposureProps = {
  children: ReactNode;
  onExposure: () => void;
};

export function RecommendationExposure({ children, onExposure }: RecommendationExposureProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const onExposureRef = useRef(onExposure);
  onExposureRef.current = onExposure;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const tracker = createExposureTracker({ onExposure: () => onExposureRef.current() });
    const updateDocumentVisibility = () => tracker.setDocumentVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => tracker.setIntersectionRatio(entry?.intersectionRatio || 0),
      { threshold: [0.5] },
    );

    updateDocumentVisibility();
    document.addEventListener("visibilitychange", updateDocumentVisibility);
    observer.observe(element);

    return () => {
      document.removeEventListener("visibilitychange", updateDocumentVisibility);
      observer.disconnect();
      tracker.dispose();
    };
  }, []);

  return <div ref={elementRef}>{children}</div>;
}
