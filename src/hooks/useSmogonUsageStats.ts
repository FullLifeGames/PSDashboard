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

export function useSmogonUsageStats(formatid: string | undefined): SmogonUsageStatsState {
  const [state, setState] = useState<SmogonUsageStatsState>(EMPTY_STATE);

  useEffect(() => {
    if (!formatid) return;

    const controller = new AbortController();
    let active = true;

    void import('../lib/smogon-stats')
      .then(({ fetchSmogonUsageStats }) => fetchSmogonUsageStats(formatid, { signal: controller.signal }))
      .then(stats => {
        if (!active) return;
        // A null result means every stats source failed — surface it so the
        // "Smogon stats unavailable" badge can actually appear (B14).
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
  }, [formatid]);

  if (!formatid) return EMPTY_STATE;
  if (state.formatid !== formatid) return { formatid, stats: null, loading: true, error: null };
  return state;
}
