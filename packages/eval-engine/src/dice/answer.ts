import { genShape } from './recognize.ts';
import type { DieKind, DieResult, Draw } from './types.ts';

/** The raw value to return, or the word that the draw cannot give the answer (the report says no-chance). */

export type Answered =
  /** For `random(from, to)` the raw value; `chance` is the numerator over the denominator of a randomChance. */
  | { value: number; chance?: number }
  | { noChance: true; chance?: number };

// A chance draw is random(denominator) < numerator: yes is the lowest value, no the highest; the Gen 2 crit compares
// random(256) against a threshold the draw does not show, so it answers 0 and 255.
function answerChance(happens: boolean, draw: Draw): Answered {
  if (draw.call !== 'chance' && draw.chance !== undefined) {
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

const CHANCE_KINDS: ReadonlySet<DieKind> = new Set(['accuracy', 'crit', 'secondary', 'self-effect', 'stalling', 'power', 'status-check', 'move-first', 'ability-proc', 'item-proc', 'end-of-turn']);

// A random with no upper end (Loaded Dice's second draw, Population Bomb's) holds a count the draw alone does not name.
function answerHits(hits: number, draw: Draw): Answered | null {
  if (draw.call === 'sample') {
    const index = draw.items?.indexOf(hits) ?? -1;
    return index < 0 ? { noChance: true } : { value: index };
  }
  if (draw.call === 'random' && draw.to !== undefined) return hits >= (draw.from ?? 0) && hits < draw.to ? { value: hits } : { noChance: true };
  return null;
}

function answerOption(option: string, draw: Draw, word: (item: unknown) => unknown = item => item): Answered | null {
  if (draw.call !== 'sample') return null;
  const index = draw.items?.findIndex(item => word(item) === option) ?? -1;
  return index < 0 ? { noChance: true } : { value: index };
}

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

// A script names the roll as random(16) does (0 top, 15 bottom), as Gens 3 and up draw it; Gens 1 and 2 draw
// random(217, 256) with 39 steps, and the 16 rolls spread over them from 255 to 217.
export function scriptRoll(gen: number, roll: number): number {
  const shape = genShape(gen).roll;
  return shape.raw(Math.round((15 - roll) * (shape.steps - 1) / 15));
}
