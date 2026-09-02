import { useEffect, useMemo, useState } from 'react';
import type { SmogonSetAssumptions } from '../lib/smogon-sets';
import { toId } from '@fulllifegames/replay-core';

interface SmogonSetAssumptionsState {
  key?: string;
  assumptions: SmogonSetAssumptions | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: SmogonSetAssumptionsState = {
  assumptions: null,
  loading: false,
  error: null,
};

export function useSmogonSetAssumptions(
  formatid: string | undefined,
  species: string[],
): SmogonSetAssumptionsState {
  const key = useMemo(
    () => `${formatid || ''}:${[...new Set(species.map(toId).filter(Boolean))].sort().join(',')}`,
    [formatid, species],
  );
  const [state, setState] = useState<SmogonSetAssumptionsState>(EMPTY_STATE);

  useEffect(() => {
    const names = [...new Set(species.filter(Boolean))];
    if (!formatid || names.length === 0) return;

    let active = true;
    void import('../lib/smogon-sets')
      .then(({ fetchSmogonSetAssumptions }) => fetchSmogonSetAssumptions({
        formatId: formatid,
        species: names,
      }))
      .then(assumptions => {
        if (!active) return;
        setState({ key, assumptions, loading: false, error: null });
      })
      .catch(error => {
        if (!active) return;
        setState({
          key,
          assumptions: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load Smogon set assumptions',
        });
      });

    return () => {
      active = false;
    };
  }, [formatid, key, species]);

  if (!formatid || species.length === 0) return EMPTY_STATE;
  if (state.key !== key) return { key, assumptions: null, loading: true, error: null };
  return state;
}
