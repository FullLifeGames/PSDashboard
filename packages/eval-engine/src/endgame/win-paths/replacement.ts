import type { Battle, SideID } from '@pkmn/sim';
import { copyOf } from '../../sim-ask/copy.ts';
import { resolveForcedSwitches } from '../../forward/switches.ts';

/**
 * Round 89 (#130): the replacements the simulator's own greedy resolution picks at a position that asks for them (a faint's, a pivot's).
 * The prover resolves them that way inside a cell (`resolveForcedSwitches`: each side's entry that evaluates best statically), so a line
 * that follows a proof shows them as steps of their own with the same choices. The resolution runs on a copy with `choose` recorded; the
 * live battle is read and never written. A side that asks for nothing is absent.
 */
export function greedyReplacements(battle: Battle): { p1?: string; p2?: string } {
  const picks: { p1?: string; p2?: string } = {};
  const copy = copyOf(battle);
  copy.prng = battle.prng.clone();
  const choose = copy.choose.bind(copy);
  copy.choose = (side: SideID, input: string) => {
    if (side === 'p1' || side === 'p2') picks[side] = input;
    return choose(side, input);
  };
  resolveForcedSwitches(copy, '1,2,3,4');
  return picks;
}
