import { PRNG, type Battle } from '@pkmn/sim';
import { deserializeBattleExact, serializeBattleStable } from '../forward/serialize.ts';
import { copyBattle } from '../forward/sim-fast/index.ts';
import { guarded } from './guard.ts';

/**
 * Round 72 (T239): copy and play. A question that has to run the simulator's own code runs on a throw-away copy of
 * the battle with dice of the asker's choosing; the live battle is read and never written.
 */

/** A throw-away copy: the speed layer's when it is on, else a round trip through the stable serialization. */
export const copyOf = (battle: Battle): Battle => copyBattle(battle) ?? deserializeBattleExact(serializeBattleStable(battle));

/** A guard against a handler that asks for a fresh draw until it likes the answer: with one answer it never would. */
const MAX_DRAWS = 5000;

export interface DiceSpec {
  /** Every `random` draw answers this quantile of its range (default one half). */
  quantile?: number;
  /** Every `randomChance` answers this; left out, chances draw from the seeded stream as the PRNG does. */
  chance?: boolean;
}

/** Dice that answer every draw with one quantile of its range, and optionally every chance with one answer. */
export class FixedDice extends PRNG {
  private readonly quantile: number;
  private readonly chance: boolean | undefined;
  private draws = 0;

  constructor({ quantile = 0.5, chance }: DiceSpec) {
    super('1,2,3,4');
    this.quantile = quantile;
    this.chance = chance;
  }

  override random(from?: number, to?: number): number {
    if (++this.draws > MAX_DRAWS) throw new Error('the dice of a played question ran out');
    if (from) from = Math.floor(from);
    if (to) to = Math.floor(to);
    if (from === undefined) return this.quantile;
    if (!to) return Math.floor(this.quantile * from);
    return Math.floor(this.quantile * (to - from)) + from;
  }

  override randomChance(numerator: number, denominator: number): boolean {
    if (this.chance === undefined) return super.randomChance(numerator, denominator);
    if (++this.draws > MAX_DRAWS) throw new Error('the dice of a played question ran out');
    return this.chance;
  }
}

/**
 * Plays on a copy of the live battle with these dice and returns what `play` returns. With the development check on,
 * a play that left a mark on the live battle throws `AskLeak`.
 */
export function playOnCopy<T>(live: Battle, dice: PRNG, play: (copy: Battle) => T, extras: readonly unknown[] = []): T {
  return guarded(live, extras, () => {
    const copy = copyOf(live);
    (copy as unknown as { debugMode: boolean }).debugMode = false;
    copy.prng = dice;
    return play(copy);
  });
}
