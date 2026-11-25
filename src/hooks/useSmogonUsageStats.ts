import { useEffect, useState } from 'react';
import type { SmogonUsageStats } from '../lib/smogon-stats';

interface SmogonUsageStatsState {
  formatid?: string;
  stats: SmogonUsageStats | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: SmogonUsageStatsState = {
  stats: null,
  loading: false,
  error: null,
};

// A new replay of the same format keeps `formatid`: after a failed load the next replay key asks once more.
function useRetryAttempt(formatid: string | undefined, replayKey: unknown, state: SmogonUsageStatsState): number {
  const [attempt, setAttempt] = useState({ replayKey, count: 0 });
  if (attempt.replayKey !== replayKey) {
    const failed = state.formatid === formatid && !!state.error;
    setAttempt({ replayKey, count: failed ? attempt.count + 1 : attempt.count });
  }
  return attempt.count;
}

export function useSmogonUsageStats(formatid: string | undefined, replayKey?: unknown): SmogonUsageStatsState {
  const [state, setState] = useState<SmogonUsageStatsState>(EMPTY_STATE);
  const attempt = useRetryAttempt(formatid, replayKey, state);

  useEffect(() => {
    if (!formatid) return;

    const controller = new AbortController();
    let active = true;

    void import('../lib/smogon-stats')
      .then(({ fetchSmogonUsageStats }) => fetchSmogonUsageStats(formatid, { signal: controller.signal }))
      .then(stats => {
        if (!active) return;
        // null: every stats source failed.
        setState({
          formatid,
          stats,
          loading: false,
          error: stats ? null : 'No Smogon usage stats found for this format',
        });
      })
      .catch(error => {
        if (!active || controller.signal.aborted) return;
        setState({
          formatid,
          stats: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load Smogon usage stats',
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [formatid, attempt]);

  if (!formatid) return EMPTY_STATE;
  if (state.formatid !== formatid) return { formatid, stats: null, loading: true, error: null };
  return state;
}
