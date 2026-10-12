import type { Battle } from '@pkmn/sim';
import { advancePositionWithLog } from '../forward/advance.ts';
import { toPosition } from '../forward/position.ts';

/**
 * Round 69 (T146 part c3): does a move's accuracy roll happen at all? A status move that the type chart, an
 * absorbing ability, Prankster against a Dark type or a powder immunity stops never rolls its accuracy, so the miss
 * class the odds plan weighs cannot occur. The simulator answers it, for every cause alike: one draw with the move's
 * accuracy roll scripted to miss shows a `|-miss|` line when the roll is reached and none when the move is stopped
 * before it. No list of moves, types or abilities.
 */

const REACH_SEED = '1,2,3,4';

/** Per read-only battle, the answers of its cells (the planner asks the same cell from several places). */
const answers = new WeakMap<Battle, Map<string, boolean>>();

/**
 * Whether `side`'s `moveId` reaches its accuracy roll in the pair of choices. A draw that does not show the move
 * (the other side's move came first and ended the turn, a failed choice) leaves it reachable: the plan stays as it was.
 */
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
