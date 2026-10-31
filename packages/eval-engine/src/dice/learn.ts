import type { Battle, PRNG } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';
import { ForcedDicePRNG } from './prng.ts';
import { dieKey, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import { watchBattle } from './watch.ts';

/**
 * Round 82 (forced dice), decision D6: a die with more than one draw, or a result the draw alone does not name, learns its raw
 * answers on copies of the battle. The module never keeps the simulator's threshold or its formula (Loaded Dice takes
 * `5 - random(2)` after a sample, Population Bomb `10 - random(7)`): it plays the turn on copies with raw answers for the die's
 * draws and reads the result from the protocol, the way a player would press the button and look.
 *
 * Only the hit count needs it today. A search over the draws in order: for the next draw it tries each value the draw can
 * give (the value the user wants first), keeps the sequence whose turn shows the wanted count, and goes one draw deeper when
 * the turn drew once more than the answers it was given.
 */

/** The deepest sequence of draws of one die the search follows (a sample, then Loaded Dice's `random(2)`). */
const MAX_DEPTH = 3;

export interface LearnInput {
  live: Battle;
  /** Every die the user forced, the one to learn among them. */
  forced: readonly ForcedDie[];
  /** The natural turn's record, so the other dice answer as they do in the real turn. */
  record: NaturalRecord;
  play: (battle: Battle) => void;
  /** A stream at the live PRNG's place, attached to the copy it will play on. */
  fork: (prng: PRNG, battle: Battle) => PRNG;
  /** The die to learn: a hit count. */
  die: ForcedDie & { result: { hits: number } };
}

interface Trial { hits: number | null; shapes: readonly Draw[] }

/** The values one draw can give, the wanted one first: a sample's distinct items by their first index, a range's integers, `random(m)`'s 0 to m-1. */
function candidatesOf(shape: Draw, wanted: number): number[] {
  if (shape.call === 'sample') {
    const items = shape.items ?? [];
    const first = new Map<unknown, number>();
    items.forEach((item, index) => { if (!first.has(item)) first.set(item, index); });
    const indexes = [...first.values()];
    const preferred = first.get(wanted);
    return preferred === undefined ? indexes : [preferred, ...indexes.filter(index => index !== preferred)];
  }
  const from = shape.to === undefined ? 0 : shape.from ?? 0;
  const to = shape.to === undefined ? shape.from ?? 0 : shape.to;
  const values = Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);
  return shape.to !== undefined && values.includes(wanted) ? [wanted, ...values.filter(value => value !== wanted)] : values;
}

/** The `|-hitcount|` the turn wrote after the die's first draw, or null when it wrote none. */
function hitCountOf(log: readonly string[], from: number): number | null {
  const line = log.slice(from).find(candidate => candidate.startsWith('|-hitcount|'));
  return line === undefined ? null : Number(line.split('|')[3]);
}

/**
 * The raw answers, one per draw of the die, that make the turn show the wanted hit count, or null when no sequence does (the
 * count is out of reach: Loaded Dice never gives two hits).
 */
export function learnHitCount(input: LearnInput): number[] | null {
  const { live, forced, record, play, fork, die } = input;
  const key = dieKey(die.name);
  const wanted = die.result.hits;

  const trial = (script: readonly number[]): Trial => {
    const copy = copyOf(live);
    (copy as unknown as { debugMode: boolean }).debugMode = false;
    const inner = fork(live.prng, copy);
    const watch = watchBattle(copy);
    const prng = new ForcedDicePRNG({ inner, watch, forced, record, scripts: new Map([[key, script]]) });
    copy.prng = prng;
    try {
      play(copy);
    } finally {
      watch.uninstall();
    }
    const note = prng.notes.get(key);
    return { hits: note?.logIndex === undefined ? null : hitCountOf(copy.log, note.logIndex), shapes: note?.shapes ?? [] };
  };

  const search = (prefix: number[], known: Trial, depth: number): number[] | null => {
    const shape = known.shapes[prefix.length];
    if (!shape) return null;
    for (const candidate of candidatesOf(shape, wanted)) {
      const next = [...prefix, candidate];
      const tried = trial(next);
      if (tried.hits === wanted) return next;
      if (depth < MAX_DEPTH && tried.shapes.length > next.length) {
        const deeper = search(next, tried, depth + 1);
        if (deeper) return deeper;
      }
    }
    return null;
  };

  return search([], trial([]), 1);
}
