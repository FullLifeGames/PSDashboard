import type { Battle } from '@pkmn/sim';
import { copyOf } from '../../sim-ask/copy.ts';
import { resolveForcedSwitches } from '../../forward/switches.ts';

/** The replacements the simulator's greedy resolution picks (a faint's, a pivot's), as the prover makes them. */
export function greedyReplacements(battle: Battle): { p1?: string; p2?: string } {
  const picks: { p1?: string; p2?: string } = {};
  const copy = copyOf(battle);
  copy.prng = battle.prng.clone();
  resolveForcedSwitches(copy, '1,2,3,4', {}, picks);
  return picks;
}
