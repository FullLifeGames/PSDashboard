import { useEffect, useState } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { GameTeamProblems } from '@fulllifegames/eval-engine';

/**
 * Round 89 (lane H, #105), stage H4: the simulator's check of the two pasted teams for the chosen format (`checkGameTeams`), run a
 * moment after a paste, a format change or a click on Validate. The result belongs to the input it was made for: a newer input
 * hides an older result at once, and a result that arrives late is dropped. The check informs; it never stops Start (user ruling
 * 13.11.2026, H2b).
 */

const DEBOUNCE_MS = 300;

export type TeamCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; problems: GameTeamProblems }
  | { state: 'failed'; message: string };

interface Result { key: string; check: TeamCheck }

export function useTeamCheck(format: string, p1: PokemonSet[], p2: PokemonSet[], nonce: number): TeamCheck {
  const empty = p1.length === 0 && p2.length === 0;
  // the signature of the input: what the sets say, not their object identity
  const key = `${format}|${nonce}|${JSON.stringify([p1, p2])}`;
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (empty) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const engine = await import('../../lib/lazy/branch-engine');
          const problems = await engine.checkGameTeams(format, { p1, p2 });
          if (live) setResult({ key, check: { state: 'done', problems } });
        } catch (error) {
          if (live) setResult({ key, check: { state: 'failed', message: error instanceof Error ? error.message : String(error) } });
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` carries every input; the sets themselves are read from the render that made the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, empty]);
  if (empty) return { state: 'idle' };
  return result?.key === key ? result.check : { state: 'checking' };
}
