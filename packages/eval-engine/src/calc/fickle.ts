import type { Dex } from '@pkmn/sim';

/** The chance and factor of a move's strength draw (Fickle Beam: 3 in 10, factor 2), read on a stand-in battle. */

export interface StrengthMix {
  numerator: number;
  denominator: number;
  chance: number;
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

export function strongerPower(basePower: number, factor: number): { basePower: number } {
  return { basePower: Math.round(basePower * factor) };
}
