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
  if (draw.call !== 'chance' && draw.chance !== undefined) {
    // a `random(100)` the script compares with the entry's chance: the simulator's state named the chance
    const top = Math.floor(draw.from ?? 1) - 1;
    if (happens) return draw.chance > 0 ? { value: 0, chance: draw.chance } : { noChance: true, chance: draw.chance };
    return draw.chance < 1 ? { value: top, chance: draw.chance } : { noChance: true, chance: draw.chance };
  }
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

/** The dice that are one chance: forced to happen or not to. */
const CHANCE_KINDS: ReadonlySet<DieKind> = new Set(['accuracy', 'crit', 'secondary', 'self-effect', 'stalling', 'power', 'status-check', 'move-first', 'ability-proc', 'item-proc', 'end-of-turn']);

/**
 * The hit count: a `sample` over the counts (the first item that equals it), or `random(from, to)` over the counts. A
 * `random` with no upper end (Loaded Dice's second draw, Population Bomb's) holds a count the draw alone does not name: the
 * learner (learn.ts) plays it out on copies.
 */
function answerHits(hits: number, draw: Draw): Answered | null {
  if (draw.call === 'sample') {
    const index = draw.items?.indexOf(hits) ?? -1;
    return index < 0 ? { noChance: true } : { value: index };
  }
  if (draw.call === 'random' && draw.to !== undefined) return hits >= (draw.from ?? 0) && hits < draw.to ? { value: hits } : { noChance: true };
  return null;
}

/**
 * A die with several results (Effect Spore's status). A `sample` over the words names its result by the item that equals it; a
 * `random(100)` that the script compares against thresholds holds a result the draw alone does not name: the learner (learn.ts)
 * plays it out on copies.
 */
function answerOption(option: string, draw: Draw, word: (item: unknown) => unknown = item => item): Answered | null {
  if (draw.call !== 'sample') return null;
  const index = draw.items?.findIndex(item => word(item) === option) ?? -1;
  return index < 0 ? { noChance: true } : { value: index };
}

/** Round 89 (#137): a sample over bodies: the foe a move is aimed at by its slot, the body a drag brings in by its name. */
const BODY_WORDS: Partial<Record<DieKind, (item: unknown) => unknown>> = {
  'random-target': item => (item as { getSlot?: () => string } | null)?.getSlot?.(),
  drag: item => (item as { name?: string } | null)?.name,
};

export function answerDie(kind: DieKind, result: DieResult, draw: Draw, gen: number): Answered | null {
  if (CHANCE_KINDS.has(kind) && 'happens' in result) return answerChance(result.happens, draw);
  if (kind === 'ability-proc' && 'option' in result) return answerOption(result.option, draw);
  if ((kind === 'random-target' || kind === 'drag') && 'option' in result) return answerOption(result.option, draw, BODY_WORDS[kind]);
  if (kind === 'hit-count' && 'hits' in result) return answerHits(result.hits, draw);
  if (kind === 'damage-roll' && 'step' in result) {
    const shape = genShape(gen).roll;
    if (!Number.isInteger(result.step) || result.step < 0 || result.step >= shape.steps) return null;
    return { value: shape.raw(result.step) };
  }
  return null;
}

/**
 * Round 86 (T299): the raw value of a script's damage roll. A script names the roll as `random(16)` does (0 is the top roll, 15
 * the bottom one); Gens 3 and up draw exactly that, Gens 1 and 2 draw `random(217, 256)` with 39 steps, and the 16 rolls spread
 * over them from the top step (255) to the bottom one (217).
 */
export function scriptRoll(gen: number, roll: number): number {
  const shape = genShape(gen).roll;
  return shape.raw(Math.round((15 - roll) * (shape.steps - 1) / 15));
}
