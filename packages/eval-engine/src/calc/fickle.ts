import type { Dex } from '@pkmn/sim';

/**
 * Round 69 (T154): a move that doubles its strength on a chance (Fickle Beam:
 * the Dex's onBasePower asks `this.randomChance(3, 10)` and chains a factor of
 * 2) is priced as the mix of its two strengths. The calc knows nothing of the
 * draw, so the chance and the factor are read from the handler itself: it runs
 * on a stand-in battle whose randomChance records its arguments and answers
 * yes and whose chainModify returns the factor. A handler that never asks for
 * a chance (Venoshock's) or needs the battle itself (Expanding Force's field)
 * is no mix. Last Respects (T76) reads a fixed strength instead.
 */

export interface StrengthMix {
  numerator: number;
  denominator: number;
  /** The chance of the stronger draw. */
  chance: number;
  /** What the stronger draw multiplies the base power by. */
  factor: number;
}

type DexLike = Pick<typeof Dex, 'moves'>;
type BasePowerHandler = (this: unknown, basePower: number, user: unknown, target: unknown, move: unknown) => unknown;

const memo = new WeakMap<object, StrengthMix | null>();

function readMix(dexMove: ReturnType<DexLike['moves']['get']>): StrengthMix | null {
  const handler = (dexMove as { onBasePower?: unknown }).onBasePower;
  if (typeof handler !== 'function') return null;
  let asked: [number, number] | null = null;
  let factor = 1;
  const stand = {
    randomChance: (numerator: number, denominator: number) => {
      asked = [numerator, denominator];
      return true;
    },
    chainModify: (modifier: number | number[]) => {
      factor = Array.isArray(modifier) ? modifier[0] / modifier[1] : modifier;
      return factor;
    },
    attrLastMove: () => undefined,
    add: () => undefined,
    debug: () => undefined,
  };
  try {
    (handler as BasePowerHandler).call(stand, dexMove.basePower, {}, {}, dexMove);
  } catch {
    return null;
  }
  const chance = asked as [number, number] | null;
  if (!chance || factor === 1) return null;
  return { numerator: chance[0], denominator: chance[1], chance: chance[0] / chance[1], factor };
}

/** The move's strength draw from the Dex handler, or null for a move that fixes its strength. */
export function strengthMix(dex: DexLike, moveName: string): StrengthMix | null {
  const dexMove = dex.moves.get(moveName);
  if (!dexMove.exists) return null;
  let mix = memo.get(dexMove);
  if (mix === undefined) {
    mix = readMix(dexMove);
    memo.set(dexMove, mix);
  }
  return mix;
}

/** The calc move's override at the stronger draw: the base power the factor makes (`basePower` is the move's power at the weaker one). */
export function strongerPower(basePower: number, factor: number): { basePower: number } {
  return { basePower: Math.round(basePower * factor) };
}
