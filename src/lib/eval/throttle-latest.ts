export interface LatestThrottle<T> {
  /** Offer a value: delivered now when the interval has passed, else held as the latest. */
  push(value: T): void;
  /** Deliver the held value now (if any). */
  flush(): void;
  /** Drop the held value; nothing pending is delivered afterwards. */
  cancel(): void;
}

/**
 * Latest-value throttle for streams where only the newest value matters
 * (search progress, partial results): the first value goes through at once,
 * a burst collapses to one delivery of its LAST value per interval. The
 * MCTS workers post progress thousands of times per evaluation; every
 * delivery is a React render, so the panel repaints at most every
 * `intervalMs` instead of per message.
 */
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
