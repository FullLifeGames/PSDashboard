import type { Battle, PRNG } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';
import { ForcedDicePRNG, type DieNote } from './prng.ts';
import { dieKey, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import { watchBattle } from './watch.ts';


// The deepest sequence of draws of one die the search follows (a sample, then Loaded Dice's random(2)).
const MAX_DEPTH = 3;

export interface LearnInput {
  live: Battle;
  forced: readonly ForcedDie[];
  record: NaturalRecord;
  play: (battle: Battle) => void;
  fork: (prng: PRNG, battle: Battle) => PRNG;
  die: ForcedDie & { result: { hits: number } };
}

interface Trial { note: DieNote | undefined; log: readonly string[] }

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

// The wanted value first: a sample's distinct items by first index, a range's integers, random(m)'s 0 to m-1.
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

function hitCountOf(log: readonly string[], from: number): number | null {
  const line = log.slice(from).find(candidate => candidate.startsWith('|-hitcount|'));
  return line === undefined ? null : Number(line.split('|')[3]);
}

/** Raw answers, one per draw, that make the turn show the wanted hit count; null when none does (Loaded Dice: two). */
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
  die: ForcedDie & { result: { option: string } };
}

function statusAfter(log: readonly string[], from: number): string | null {
  const line = log.slice(from).find(candidate => candidate.startsWith('|-status|'));
  return line === undefined ? null : line.split('|')[3];
}

// A random(m) is bisected: the statuses are runs of numbers, so the search goes into the halves whose ends differ.
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
