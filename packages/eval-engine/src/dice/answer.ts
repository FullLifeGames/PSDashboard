import { genShape } from './recognize.ts';
import type { DieKind, DieResult, Draw } from './types.ts';

/**
 * Round 82 (forced dice), decision D4: how a forced die answers. The PRNG calls this with the draw it is in the middle of and
 * gets back the raw value to return, or the word that this draw has no way to give the answer (the PRNG then keeps the
 * natural value and the report says `no-chance`). Null means the result does not fit the kind of die: nothing is forced.
 */

export type Answered =
  /** The raw value to return for `random(from, to)`; `chance` is the numerator over the denominator of a `randomChance`. */
  | { value: number; chance?: number }
  | { noChance: true; chance?: number };

/**
 * A chance draw is `random(denominator) < numerator`: yes is the lowest value, no the highest. Yes needs a numerator above
 * zero, no needs a numerator below the denominator; the Gen 2 crit compares `random(256)` against a threshold the draw does
 * not show, so it answers 0 and 255 and leaves the verdict to the protocol.
 */
function answerChance(happens: boolean, draw: Draw): Answered {
  if (draw.call === 'chance') {
    const denominator = draw.from ?? 1;
    const numerator = draw.numerator ?? 0;
    const chance = numerator / denominator;
    const top = Math.floor(denominator) - 1;
    if (happens) return numerator > 0 ? { value: 0, chance } : { noChance: true, chance };
    return numerator <= top ? { value: top, chance } : { noChance: true, chance };
  }
  return happens ? { value: 0 } : { value: Math.floor(draw.from ?? 1) - 1 };
}

export function answerDie(kind: DieKind, result: DieResult, draw: Draw, gen: number): Answered | null {
  if ((kind === 'accuracy' || kind === 'crit') && 'happens' in result) return answerChance(result.happens, draw);
  if (kind === 'damage-roll' && 'step' in result) {
    const shape = genShape(gen).roll;
    if (!Number.isInteger(result.step) || result.step < 0 || result.step >= shape.steps) return null;
    return { value: shape.raw(result.step) };
  }
  return null;
}
