import type { Side } from '@pkmn/sim';
import { deserializeBattleExact, serializeBattleStable } from '../forward/serialize.ts';
import type { MctsCallbacks } from '../mcts.ts';
import type { SearchExecutor } from '../orchestrator.ts';
import type {
  EvalCellJob, EvalCellValue, EvalChoiceOption, EvalResult, EvalSubSearchJob, ForcedWinInput, KoOddsMismatch, MctsTreeStats,
} from '../types.ts';

/**
 * Round 67 (T129): the search sees every board with its bench in one fixed
 * order. The order in which a rebuild keeps the bench in the simulator's team
 * list is not part of the game, but the search read it: the static sums over
 * the team in list order, and a tie among replacement hints (every singles
 * hint is 0 once the opposing active fell) falls to it, so two boards of one
 * game state parted at their first near tie (649664 t14: the switch to
 * Ferrothorn read best on one board and a blunder on the other). Every entry
 * point searches the board with each side's bench sorted by species and
 * nickname (the active slots stay where they are), names every choice that
 * leaves the search back in the slots of the board it was asked about, and
 * every choice that enters it in the canonical slots. Move targets name
 * active slots and stay as they are.
 */

type SideId = 'p1' | 'p2';

export interface BenchOrder {
  /** The board with each side's bench in canonical order: the string the search runs on. */
  readonly serialized: string;
  /** Per side, the given board's slot index of each canonical slot index (0-based). */
  readonly toGiven: readonly [readonly number[], readonly number[]];
  /** Per side, the canonical slot index of each given slot index (0-based). */
  readonly toCanonical: readonly [readonly number[], readonly number[]];
}

const sideIndex = (side: SideId): 0 | 1 => (side === 'p1' ? 0 : 1);

/**
 * Species id, then nickname, compared by code unit (no locale). The same key
 * reads off the serialized board ('[Species:<id>]' and set.name), so a board
 * already in canonical order is recognized without deserializing it.
 */
const benchKey = (speciesId: string, name: string | undefined): string => `${speciesId}\u0000${name ?? ''}`;
const byKey = (a: { key: string; index: number }, b: { key: string; index: number }): number =>
  (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index);

/**
 * One side's canonical order as given slot indices: the active slots in
 * place, then the bench by species and nickname (equal keys keep their
 * order). Team preview seats nobody, so every body counts as bench there; a
 * board whose actives do not sit in their own slots keeps its order.
 */
function canonicalOrder(side: Side): number[] {
  const slots = side.pokemon.map((_, index) => index);
  const seated = side.active.some(Boolean);
  if (seated && side.active.some((pokemon, index) => pokemon && side.pokemon[index] !== pokemon)) return slots;
  const fixed = seated ? side.active.length : 0;
  const bench = slots.slice(fixed).map(index => ({ index, key: benchKey(side.pokemon[index].species.id, side.pokemon[index].set.name) })).sort(byKey);
  return [...slots.slice(0, fixed), ...bench.map(entry => entry.index)];
}

interface SerializedSide { active?: (string | null)[]; pokemon?: { species?: string; set?: { name?: string } }[] }

/** Whether a serialized side's bench already sits in canonical order, read off the JSON (the same key as canonicalOrder). */
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
    // A board the exact deserializer cannot read is searched as given (the search reports its own error).
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

/** The last board asked about: the trees of one search ask four times in a row. */
let last: { serialized: string; order: BenchOrder | null } | null = null;

/** The canonical board and its slot maps; null when every bench already sits in canonical order (the board is searched as given). */
export function benchOrder(serialized: string): BenchOrder | null {
  if (last?.serialized !== serialized) last = { serialized, order: computeBenchOrder(serialized) };
  return last.order;
}

/** A choice with its slots mapped: `switch N` (a pivot's follow-up and doubles parts too) and team preview digits. */
function mapSlots(choice: string, map: readonly number[]): string {
  const slot = (digits: string) => String(map[Number(digits) - 1] + 1);
  if (choice.startsWith('team ')) return `team ${[...choice.slice(5)].map(slot).join('')}`;
  return choice.replace(/switch (\d+)/g, (_match, digits: string) => `switch ${slot(digits)}`);
}

/** A choice of the canonical board named in the given board's slots. */
export const choiceToGiven = (order: BenchOrder, side: SideId, choice: string): string => mapSlots(choice, order.toGiven[sideIndex(side)]);

/** A choice of the given board named in the canonical board's slots. */
export const choiceToCanonical = (order: BenchOrder, side: SideId, choice: string): string => mapSlots(choice, order.toCanonical[sideIndex(side)]);

const optionsToGiven = <T extends EvalChoiceOption>(order: BenchOrder, side: SideId, options: T[]): T[] =>
  options.map(option => ({ ...option, choice: choiceToGiven(order, side, option.choice) }));

const diagnosticToGiven = (order: BenchOrder, diagnostic: KoOddsMismatch): KoOddsMismatch => ({
  ...diagnostic, p1Choice: choiceToGiven(order, 'p1', diagnostic.p1Choice), p2Choice: choiceToGiven(order, 'p2', diagnostic.p2Choice),
});

/** A result of the canonical board named in the given board's slots: the rankings, the matrix ids and the diagnostics (labels, lines and odds name species). */
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

/** One tree's statistics in the given board's slots (cell keys, odds and boundary cells stay index-aligned with the options). */
export const treeToGiven = (order: BenchOrder, tree: MctsTreeStats): MctsTreeStats => ({
  ...tree,
  p1Options: optionsToGiven(order, 'p1', tree.p1Options),
  p2Options: optionsToGiven(order, 'p2', tree.p2Options),
  ...(tree.p1Legal ? { p1Legal: optionsToGiven(order, 'p1', tree.p1Legal) } : {}),
  ...(tree.p2Legal ? { p2Legal: optionsToGiven(order, 'p2', tree.p2Legal) } : {}),
  result: resultToGiven(order, tree.result),
});

/** Partial results leave the search in the given board's slots too. */
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

/**
 * An executor over the canonical board that speaks the given board's slots:
 * its option lists and diagnostics leave in them, cell and sub-search jobs
 * and the prover's root order arrive in them.
 */
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

/** The prover's root order in the canonical board's slots, for a string entry point. */
export const rootOrderToCanonical = (order: BenchOrder, side: SideId, rootOrder: string[]): string[] =>
  rootOrder.map(choice => choiceToCanonical(order, side, choice));
