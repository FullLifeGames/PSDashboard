import { PRNG, type Battle } from '@pkmn/sim';
import { deserializeBattleExact, serializeBattleStable } from '../forward/serialize.ts';
import { copyBattle } from '../forward/sim-fast/index.ts';
import { guarded } from './guard.ts';

export const copyOf = (battle: Battle): Battle => copyBattle(battle) ?? deserializeBattleExact(serializeBattleStable(battle));

// A handler that asks for a fresh draw until it likes the answer would never stop with one answer: this caps it.
const MAX_DRAWS = 5000;

export interface DiceSpec {
  /** Every `random` draw answers this quantile of its range (default one half). */
  quantile?: number;
  /** Every `randomChance` answers this; left out, chances draw from the seeded stream as the PRNG does. */
  chance?: boolean;
  /** Every `randomChance` answers yes when it is at least even; wins over `chance`. */
  likely?: boolean;
}

export class FixedDice extends PRNG {
  private readonly quantile: number;
  private readonly chance: boolean | undefined;
  private readonly likely: boolean;
  private draws = 0;
  /** The first chance asked since the last `clearChance`, numerator over denominator. */
  firstChance: number | null = null;

  constructor({ quantile = 0.5, chance, likely = false }: DiceSpec) {
    super('1,2,3,4');
    this.quantile = quantile;
    this.chance = chance;
    this.likely = likely;
  }

  override random(from?: number, to?: number): number {
    if (++this.draws > MAX_DRAWS) throw new Error('the dice of a played question ran out');
    if (from) from = Math.floor(from);
    if (to) to = Math.floor(to);
    if (from === undefined) return this.quantile;
    if (!to) return Math.floor(this.quantile * from);
    return Math.floor(this.quantile * (to - from)) + from;
  }

  clearChance(): void {
    this.firstChance = null;
  }

  override randomChance(numerator: number, denominator: number): boolean {
    this.firstChance ??= numerator / denominator;
    if (this.likely) {
      if (++this.draws > MAX_DRAWS) throw new Error('the dice of a played question ran out');
      return numerator * 2 >= denominator;
    }
    if (this.chance === undefined) return super.randomChance(numerator, denominator);
    if (++this.draws > MAX_DRAWS) throw new Error('the dice of a played question ran out');
    return this.chance;
  }
}

/** Plays on a copy with these dice and returns what `play` returns; the live battle is never written. */
export function playOnCopy<T>(live: Battle, dice: PRNG, play: (copy: Battle) => T, extras: readonly unknown[] = []): T {
  return guarded(live, extras, () => {
    const copy = copyOf(live);
    (copy as unknown as { debugMode: boolean }).debugMode = false;
    copy.prng = dice;
    return play(copy);
  });
}
