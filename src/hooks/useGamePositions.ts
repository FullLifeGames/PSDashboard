import { useCallback, useMemo, useRef } from 'react';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { NewGameRecord } from '../lib/new-game/record';
import { gameAdoptSnapshot, restoreGamePositions } from './branch/game-rebuild';

/**
 * Round 89 (lane H, #105): the positions of a new game come from its record, never from a 'replay' job: the main line's positions
 * land in the exact store as the turns are promoted, and a position the store lacks (a reloaded game, an edited team) is rebuilt
 * once from the record's entries, which stores them all.
 */
export function useGamePositions(args: {
  record: NewGameRecord | null;
  snapshots: TurnSnapshot[];
  exact: { getExact(turn: number): string | null; storeExactPosition(turn: number, serialized: string): void };
}) {
  const { record, snapshots, exact } = args;
  const restoring = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const restore = useCallback(async () => {
    if (!record) return;
    const key = `${record.id}:${record.updatedAt}`;
    if (restoring.current?.key !== key) {
      restoring.current = {
        key,
        promise: (async () => {
          const branchEngine = await import('../lib/lazy/branch-engine');
          await branchEngine.loadSimMods(record.format);
          await restoreGamePositions(branchEngine, record, exact.storeExactPosition);
        })(),
      };
    }
    await restoring.current.promise;
  }, [record, exact]);

  const acquireExact = useCallback(async (turn: number): Promise<string> => {
    let stored = exact.getExact(turn);
    if (!stored) {
      await restore();
      stored = exact.getExact(turn);
    }
    if (!stored) throw new Error(`The game holds no position for turn ${turn}.`);
    return stored;
  }, [exact, restore]);

  const acquireAll = useCallback(async (
    turns: number, report: (turn: number, target: number) => void, onPosition?: (turn: number, serialized: string) => void,
  ): Promise<(string | null)[]> => {
    const positions: (string | null)[] = new Array(turns).fill(null);
    for (let turn = 1; turn <= turns; turn += 1) {
      positions[turn - 1] = await acquireExact(turn).catch(() => null);
      const position = positions[turn - 1];
      if (position) onPosition?.(turn, position);
      report(turn, turns);
    }
    return positions;
  }, [acquireExact]);

  const adoptSnapshot = useCallback((turn: number) => gameAdoptSnapshot(snapshots, turn), [snapshots]);

  return useMemo(() => (record ? { acquireExact, acquireAll, adoptSnapshot } : null), [record, acquireExact, acquireAll, adoptSnapshot]);
}

export type GamePositions = NonNullable<ReturnType<typeof useGamePositions>>;
