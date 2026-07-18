import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExposureTracker } from "./exposure-tracker";

describe("Exposure tracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("requires at least 50% visibility for 500 ms", () => {
    const onExposure = vi.fn();
    const tracker = createExposureTracker({ onExposure });

    tracker.setIntersectionRatio(0.49);
    vi.advanceTimersByTime(1_000);
    tracker.setIntersectionRatio(0.5);
    vi.advanceTimersByTime(499);
    expect(onExposure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExposure).toHaveBeenCalledOnce();
  });

  it("cancels the pending threshold when visibility drops or the document is hidden", () => {
    const onExposure = vi.fn();
    const tracker = createExposureTracker({ onExposure });

    tracker.setIntersectionRatio(0.8);
    vi.advanceTimersByTime(300);
    tracker.setIntersectionRatio(0.2);
    vi.advanceTimersByTime(500);
    tracker.setIntersectionRatio(0.8);
    vi.advanceTimersByTime(300);
    tracker.setDocumentVisible(false);
    vi.advanceTimersByTime(500);
    expect(onExposure).not.toHaveBeenCalled();

    tracker.setDocumentVisible(true);
    vi.advanceTimersByTime(500);
    expect(onExposure).toHaveBeenCalledOnce();
  });

  it("emits once and cancels pending work on disposal", () => {
    const onExposure = vi.fn();
    const tracker = createExposureTracker({ onExposure });

    tracker.setIntersectionRatio(1);
    vi.advanceTimersByTime(500);
    tracker.setIntersectionRatio(0);
    tracker.setIntersectionRatio(1);
    vi.advanceTimersByTime(500);
    expect(onExposure).toHaveBeenCalledOnce();

    const disposedExposure = vi.fn();
    const disposed = createExposureTracker({ onExposure: disposedExposure });
    disposed.setIntersectionRatio(1);
    disposed.dispose();
    vi.advanceTimersByTime(500);
    expect(disposedExposure).not.toHaveBeenCalled();
  });
});
