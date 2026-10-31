import type { Battle, PRNG } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';
import { ForcedDicePRNG, type DieNote } from './prng.ts';
import { dieKey, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import { watchBattle } from './watch.ts';

/**
 * Round 82 (forced dice), decision D6: a die with more than one draw, or a result the draw alone does not name, learns its raw
 * answers on copies of the battle. The module never keeps the simulator's threshold or its formula (Loaded Dice takes
 * `5 - random(2)` after a sample, Population Bomb `10 - random(7)`, Effect Spore compares one number from 0 to 99 with its own
 * thresholds): it plays the turn on copies with raw answers for the die's draws and reads the result from the protocol, the way
 * a player would press the button and look.
 *
 * The hit count is a search over the die's draws in order: for the next draw it tries each value the draw can give (the value
 * the user wants first), keeps the sequence whose turn shows the wanted count, and goes one draw deeper when the turn drew once
 * more than the answers it was given. Effect Spore's status (round 82, step A4) is one draw whose results are runs of
 * numbers: the search bisects the range of the draw, reading the status the protocol shows at each probe.
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

interface Trial { note: DieNote | undefined; log: readonly string[] }

/** The forced turn on a copy, with raw answers for one die's draws. */
function trialOf(input: Omit<LearnInput, 'die'>, key: string, script: readonly number[]): Trial {
  const { live, forced, record, play, fork } = input;
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
  return { note: prng.notes.get(key), log: copy.log };
}

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
  const { die } = input;
  const key = dieKey(die.name);
  const wanted = die.result.hits;

  const trial = (script: readonly number[]): { hits: number | null; shapes: readonly Draw[] } => {
    const { note, log } = trialOf(input, key, script);
    return { hits: note?.logIndex === undefined ? null : hitCountOf(log, note.logIndex), shapes: note?.shapes ?? [] };
  };

  const search = (prefix: number[], known: { shapes: readonly Draw[] }, depth: number): number[] | null => {
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

export interface LearnOptionInput extends Omit<LearnInput, 'die'> {
  /** The die to learn: a status word the draw leads to. */
  die: ForcedDie & { result: { option: string } };
}

/** The status the turn wrote after the die's first draw (`|-status|p1a: X|par|...`), or null when it wrote none. */
function statusAfter(log: readonly string[], from: number): string | null {
  const line = log.slice(from).find(candidate => candidate.startsWith('|-status|'));
  return line === undefined ? null : line.split('|')[3];
}

/**
 * The raw answer of the die's one draw that makes the turn show the wanted status, or null when no number does (the target
 * cannot take the status, or the die never draws). A `sample` over words names its result by the item; a `random(m)` is
 * bisected: the statuses are runs of numbers, so the search reads both ends of a range and goes into the halves whose ends
 * differ.
 */
export function learnOption(input: LearnOptionInput): number[] | null {
  const { die } = input;
  const key = dieKey(die.name);
  const wanted = die.result.option;
  const first = trialOf(input, key, []);
  const shape = first.note?.shapes[0];
  if (!shape) return null;
  if (shape.call === 'sample') {
    const index = shape.items?.indexOf(wanted) ?? -1;
    return index < 0 ? null : [index];
  }
  if (shape.call !== 'random' || shape.to !== undefined || shape.from === undefined) return null;
  const at = (value: number): string | null => {
    const { note, log } = trialOf(input, key, [value]);
    return note?.logIndex === undefined ? null : statusAfter(log, note.logIndex);
  };
  const find = (low: number, high: number, atLow: string | null, atHigh: string | null): number | null => {
    if (atLow === wanted) return low;
    if (atHigh === wanted) return high;
    if (high - low <= 1 || atLow === atHigh) return null;
    const middle = Math.floor((low + high) / 2);
    const atMiddle = at(middle);
    if (atMiddle === wanted) return middle;
    const left = find(low, middle, atLow, atMiddle);
    return left ?? find(middle, high, atMiddle, atHigh);
  };
  const top = shape.from - 1;
  const answer = find(0, top, at(0), at(top));
  return answer === null ? null : [answer];
}

/**
 * Every status the die's one draw can lead to, read from the protocol: the offer lists them as the results of the die. A `sample`
 * over words names them by its items; a `random(m)` is bisected like `learnOption` does, collecting the status at every probe.
 */
export function reachableOptions(input: Omit<LearnInput, 'die'> & { name: ForcedDie['name'] }): string[] {
  const key = dieKey(input.name);
  const forced = [...input.forced, { name: input.name, result: { happens: true } }];
  const first = trialOf({ ...input, forced }, key, []);
  const shape = first.note?.shapes[0];
  if (!shape) return [];
  if (shape.call === 'sample') return [...new Set((shape.items ?? []).map(String))];
  if (shape.call !== 'random' || shape.to !== undefined || shape.from === undefined) return [];
  const seen = new Set<string>();
  const at = (value: number): string | null => {
    const { note, log } = trialOf({ ...input, forced }, key, [value]);
    const word = note?.logIndex === undefined ? null : statusAfter(log, note.logIndex);
    if (word) seen.add(word);
    return word;
  };
  const walk = (low: number, high: number, atLow: string | null, atHigh: string | null): void => {
    if (high - low <= 1 || atLow === atHigh) return;
    const middle = Math.floor((low + high) / 2);
    const atMiddle = at(middle);
    walk(low, middle, atLow, atMiddle);
    walk(middle, high, atMiddle, atHigh);
  };
  const top = shape.from - 1;
  walk(0, top, at(0), at(top));
  return [...seen];
}
