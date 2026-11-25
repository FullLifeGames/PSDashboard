import type { Side } from '@pkmn/sim';
import { deserializeBattleExact, serializeBattleStable } from '../forward/serialize.ts';
import type { MctsCallbacks } from '../mcts.ts';
import type { SearchExecutor } from '../orchestrator.ts';
import type {
  EvalCellJob, EvalCellValue, EvalChoiceOption, EvalResult, EvalSubSearchJob, ForcedWinInput, KoOddsMismatch, MctsTreeStats,
} from '../types.ts';

// Bench order is no part of the game, yet a near tie falls to it: the search sorts benches by species and nickname.

type SideId = 'p1' | 'p2';

export interface BenchOrder {
  readonly serialized: string;
  /** Per side, the given board's slot index of each canonical slot index (0-based). */
  readonly toGiven: readonly [readonly number[], readonly number[]];
  /** Per side, the canonical slot index of each given slot index (0-based). */
  readonly toCanonical: readonly [readonly number[], readonly number[]];
}

const sideIndex = (side: SideId): 0 | 1 => (side === 'p1' ? 0 : 1);

// By code unit, no locale; the same key reads off the serialized board ('[Species:<id>]' and set.name).
const benchKey = (speciesId: string, name: string | undefined): string => `${speciesId}\u0000${name ?? ''}`;
const byKey = (a: { key: string; index: number }, b: { key: string; index: number }): number =>
  (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index);

function canonicalOrder(side: Side): number[] {
  const slots = side.pokemon.map((_, index) => index);
  const seated = side.active.some(Boolean);
  if (seated && side.active.some((pokemon, index) => pokemon && side.pokemon[index] !== pokemon)) return slots;
  const fixed = seated ? side.active.length : 0;
  const bench = slots.slice(fixed).map(index => ({ index, key: benchKey(side.pokemon[index].species.id, side.pokemon[index].set.name) })).sort(byKey);
  return [...slots.slice(0, fixed), ...bench.map(entry => entry.index)];
}

interface SerializedSide { active?: (string | null)[]; pokemon?: { species?: string; set?: { name?: string } }[] }

function canonicalAsSerialized(side: SerializedSide | undefined): boolean {
  const active = side?.active ?? [];
  const fixed = active.some(Boolean) ? active.length : 0;
  const keys = (side?.pokemon ?? []).slice(fixed)
    .map(entry => benchKey((entry.species ?? '').replace(/^\[Species:(.*)\]$/, '$1'), entry.set?.name));
  return keys.every((key, index) => index === 0 || keys[index - 1] <= key);
}

const inverse = (order: readonly number[]): number[] => {
  const out = new Array<number>(order.length);
  order.forEach((given, canonical) => { out[given] = canonical; });
  return out;
};

function computeBenchOrder(serialized: string): BenchOrder | null {
  let battle;
  try {
    const sides = (JSON.parse(serialized) as { sides?: SerializedSide[] }).sides;
    if (canonicalAsSerialized(sides?.[0]) && canonicalAsSerialized(sides?.[1])) return null;
    battle = deserializeBattleExact(serialized);
  } catch {
    return null;
  }
  const orders = [canonicalOrder(battle.sides[0]), canonicalOrder(battle.sides[1])];
  if (orders.every(order => order.every((given, canonical) => given === canonical))) return null;
  [battle.sides[0], battle.sides[1]].forEach((side, index) => {
    side.pokemon = orders[index].map(given => side.pokemon[given]);
    side.pokemon.forEach((pokemon, position) => { pokemon.position = position; });
  });
  return {
    serialized: serializeBattleStable(battle),
    toGiven: [orders[0], orders[1]],
    toCanonical: [inverse(orders[0]), inverse(orders[1])],
  };
}

let last: { serialized: string; order: BenchOrder | null } | null = null;

/** The canonical board and its slot maps; null when every bench already sits in canonical order. */
export function benchOrder(serialized: string): BenchOrder | null {
  if (last?.serialized !== serialized) last = { serialized, order: computeBenchOrder(serialized) };
  return last.order;
}

function mapSlots(choice: string, map: readonly number[]): string {
  const slot = (digits: string) => String(map[Number(digits) - 1] + 1);
  if (choice.startsWith('team ')) return `team ${[...choice.slice(5)].map(slot).join('')}`;
  return choice.replace(/switch (\d+)/g, (_match, digits: string) => `switch ${slot(digits)}`);
}

export const choiceToGiven = (order: BenchOrder, side: SideId, choice: string): string => mapSlots(choice, order.toGiven[sideIndex(side)]);

export const choiceToCanonical = (order: BenchOrder, side: SideId, choice: string): string => mapSlots(choice, order.toCanonical[sideIndex(side)]);

const optionsToGiven = <T extends EvalChoiceOption>(order: BenchOrder, side: SideId, options: T[]): T[] =>
  options.map(option => ({ ...option, choice: choiceToGiven(order, side, option.choice) }));

const diagnosticToGiven = (order: BenchOrder, diagnostic: KoOddsMismatch): KoOddsMismatch => ({
  ...diagnostic, p1Choice: choiceToGiven(order, 'p1', diagnostic.p1Choice), p2Choice: choiceToGiven(order, 'p2', diagnostic.p2Choice),
});

export function resultToGiven(order: BenchOrder, result: EvalResult): EvalResult {
  const rows = (side: SideId) => result.perSide[side].map(row => ({ ...row, choice: choiceToGiven(order, side, row.choice) }));
  const named: EvalResult = { ...result, perSide: { p1: rows('p1'), p2: rows('p2') } };
  if (result.matrix) {
    named.matrix = {
      ...result.matrix,
      ...(result.matrix.p1Choices ? { p1Choices: result.matrix.p1Choices.map(choice => choiceToGiven(order, 'p1', choice)) } : {}),
      ...(result.matrix.p2Choices ? { p2Choices: result.matrix.p2Choices.map(choice => choiceToGiven(order, 'p2', choice)) } : {}),
    };
  }
  if (result.koDiagnostics) named.koDiagnostics = result.koDiagnostics.map(diagnostic => diagnosticToGiven(order, diagnostic));
  return named;
}

/** One tree's statistics in the given board's slots; cell keys stay index-aligned with the options. */
export const treeToGiven = (order: BenchOrder, tree: MctsTreeStats): MctsTreeStats => ({
  ...tree,
  p1Options: optionsToGiven(order, 'p1', tree.p1Options),
  p2Options: optionsToGiven(order, 'p2', tree.p2Options),
  ...(tree.p1Legal ? { p1Legal: optionsToGiven(order, 'p1', tree.p1Legal) } : {}),
  ...(tree.p2Legal ? { p2Legal: optionsToGiven(order, 'p2', tree.p2Legal) } : {}),
  result: resultToGiven(order, tree.result),
});

export const callbacksToGiven = <T extends MctsCallbacks>(order: BenchOrder, callbacks: T | undefined): T | undefined => (callbacks?.onPartial
  ? { ...callbacks, onPartial: (partial: EvalResult) => callbacks.onPartial!(resultToGiven(order, partial)) }
  : callbacks);

const jobToCanonical = <T extends EvalCellJob | EvalSubSearchJob>(order: BenchOrder, job: T): T => ({
  ...job, p1Choice: choiceToCanonical(order, 'p1', job.p1Choice), p2Choice: choiceToCanonical(order, 'p2', job.p2Choice),
});

const valueToGiven = (order: BenchOrder, value: EvalCellValue): EvalCellValue =>
  (value.diagnostic ? { ...value, diagnostic: diagnosticToGiven(order, value.diagnostic) } : value);

const inputToCanonical = (order: BenchOrder, input: ForcedWinInput): ForcedWinInput => ({
  ...input,
  rootOrder: {
    p1: input.rootOrder.p1.map(choice => choiceToCanonical(order, 'p1', choice)),
    p2: input.rootOrder.p2.map(choice => choiceToCanonical(order, 'p2', choice)),
  },
});

/** An executor over the canonical board that speaks the given board's slots in both directions. */
export function executorToGiven(order: BenchOrder, executor: SearchExecutor): SearchExecutor {
  return {
    choices: async (tera, keepPlayed, sleepClause) => {
      const info = await executor.choices(tera, keepPlayed, sleepClause);
      return { ...info, p1: optionsToGiven(order, 'p1', info.p1), p2: optionsToGiven(order, 'p2', info.p2) };
    },
    evalCells: async (jobs, onDone) =>
      (await executor.evalCells(jobs.map(job => jobToCanonical(order, job)), onDone)).map(value => valueToGiven(order, value)),
    subSearch: job => executor.subSearch(jobToCanonical(order, job)),
    prove: input => executor.prove(inputToCanonical(order, input)),
  };
}
