import type { Battle } from '@pkmn/sim';
import { advancePositionWithLog } from '../forward/advance.ts';
import { toPosition } from '../forward/position.ts';

// A status move stopped by the type chart, an absorbing ability, Prankster vs Dark or a powder immunity never rolls
// accuracy: one draw with the accuracy roll scripted to miss shows `|-miss|` only when the roll is reached.

const REACH_SEED = '1,2,3,4';

const answers = new WeakMap<Battle, Map<string, boolean>>();

/** Whether `side`'s `moveId` reaches its accuracy roll; a draw that does not show the move leaves it reachable. */
export function accuracyRollReached(battle: Battle, side: 'p1' | 'p2', moveId: string, p1Choice: string, p2Choice: string): boolean {
  const key = `${side}:${moveId}:${p1Choice}:${p2Choice}`;
  const known = answers.get(battle)?.get(key);
  if (known !== undefined) return known;
  let reached = true;
  try {
    const scripts = new Map([[`${side}:${moveId}`, { hit: false }]]);
    const { log } = advancePositionWithLog(toPosition(battle), p1Choice, p2Choice, REACH_SEED, { scripts });
    const prefix = `|move|${side}a:`;
    const moves = log.flatMap((line, at) => (line.startsWith(prefix) ? [at] : []));
    if (moves.length === 1) reached = log.some((line, at) => at > moves[0] && line.startsWith(`|-miss|${side}a:`));
  } catch {
    reached = true;
  }
  const byKey = answers.get(battle) ?? new Map<string, boolean>();
  byKey.set(key, reached);
  answers.set(battle, byKey);
  return reached;
}
