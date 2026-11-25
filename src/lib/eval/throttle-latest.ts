export interface LatestThrottle<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
}

/** Latest-value throttle: the first value goes through at once, a burst collapses to its last value per interval. */
export function throttleLatest<T>(deliver: (value: T) => void, intervalMs: number): LatestThrottle<T> {
  let lastAt = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (value: T) => {
    lastAt = Date.now();
    pending = null;
    deliver(value);
  };
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const fire = () => {
    timer = null;
    if (pending) emit(pending.value);
  };

  return {
    push(value) {
      const wait = lastAt + intervalMs - Date.now();
      if (wait <= 0 && timer === null) {
        emit(value);
        return;
      }
      pending = { value };
      if (timer === null) timer = setTimeout(fire, Math.max(0, wait));
    },
    flush() {
      clearTimer();
      if (pending) emit(pending.value);
    },
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}
