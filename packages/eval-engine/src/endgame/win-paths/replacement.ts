import type { Battle, SideID } from '@pkmn/sim';
import { copyOf } from '../../sim-ask/copy.ts';
import { resolveForcedSwitches } from '../../forward/switches.ts';

/** The replacements the simulator's greedy resolution picks (a faint's, a pivot's), as the prover makes them. */
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
