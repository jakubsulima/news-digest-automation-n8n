type ExposureTracker = {
  dispose: () => void;
  setDocumentVisible: (visible: boolean) => void;
  setIntersectionRatio: (ratio: number) => void;
};

type TimerHandle = ReturnType<typeof setTimeout>;

export function createExposureTracker(options: {
  cancel?: (handle: TimerHandle) => void;
  delayMs?: number;
  onExposure: () => void;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  threshold?: number;
}): ExposureTracker {
  const cancel = options.cancel || clearTimeout;
  const delayMs = options.delayMs ?? 500;
  const schedule = options.schedule || setTimeout;
  const threshold = options.threshold ?? 0.5;
  let disposed = false;
  let documentVisible = true;
  let emitted = false;
  let intersectionRatio = 0;
  let timer: TimerHandle | null = null;

  function cancelPending() {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  }

  function reconcile() {
    const qualifies = !disposed && !emitted && documentVisible && intersectionRatio >= threshold;
    if (!qualifies) {
      cancelPending();
      return;
    }
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      if (disposed || emitted || !documentVisible || intersectionRatio < threshold) return;
      emitted = true;
      options.onExposure();
    }, delayMs);
  }

  return {
    dispose() {
      disposed = true;
      cancelPending();
    },
    setDocumentVisible(visible) {
      documentVisible = visible;
      reconcile();
    },
    setIntersectionRatio(ratio) {
      intersectionRatio = Number.isFinite(ratio) ? ratio : 0;
      reconcile();
    },
  };
}
