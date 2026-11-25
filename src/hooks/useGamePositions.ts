import { useCallback, useMemo, useRef } from 'react';
import type { NewGameRecord } from '../lib/new-game/record';
import { gameAdoptSnapshot, restoreGamePositions } from './branch/game-rebuild';

/** Positions of a new game come from its record, never a 'replay' job; one sweep rebuilds at most once. */
export function useGamePositions(args: {
  record: NewGameRecord | null;
  exact: { getExact(turn: number): string | null; storeExactPosition(turn: number, serialized: string): void };
}) {
  const { record, exact } = args;
  const restoring = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const restore = useCallback(async () => {
    if (!record) return;
    const key = `${record.id}:${record.updatedAt}`;
    let running = restoring.current;
    if (running?.key !== key) {
      const entry = {
        key,
        promise: (async () => {
          const branchEngine = await import('../lib/lazy/branch-engine');
          await branchEngine.loadSimMods(record.format);
          await restoreGamePositions(branchEngine, record, exact.storeExactPosition);
        })(),
      };
      const forget = () => { if (restoring.current === entry) restoring.current = null; };
      entry.promise.then(forget, forget);
      restoring.current = entry;
      running = entry;
    }
    await running.promise;
  }, [record, exact]);

  const positionOf = useCallback(async (turn: number, attempt: { rebuilt: boolean }): Promise<string> => {
    let stored = exact.getExact(turn);
    if (!stored && !attempt.rebuilt) {
      attempt.rebuilt = true;
      await restore();
      stored = exact.getExact(turn);
    }
    if (!stored) throw new Error(`The game holds no position for turn ${turn}.`);
    return stored;
  }, [exact, restore]);

  const acquireExact = useCallback((turn: number): Promise<string> => positionOf(turn, { rebuilt: false }), [positionOf]);

  const acquireAll = useCallback(async (
    turns: number, report: (turn: number, target: number) => void, onPosition?: (turn: number, serialized: string) => void,
  ): Promise<(string | null)[]> => {
    const positions: (string | null)[] = new Array(turns).fill(null);
    const attempt = { rebuilt: false };
    for (let turn = 1; turn <= turns; turn += 1) {
      positions[turn - 1] = await positionOf(turn, attempt).catch(() => null);
      const position = positions[turn - 1];
      if (position) onPosition?.(turn, position);
      report(turn, turns);
    }
    return positions;
  }, [positionOf]);

  const adoptSnapshot = useCallback(() => gameAdoptSnapshot(), []);

  return useMemo(() => (record ? { acquireExact, acquireAll, adoptSnapshot } : null), [record, acquireExact, acquireAll, adoptSnapshot]);
}

export type GamePositions = NonNullable<ReturnType<typeof useGamePositions>>;
