import { PRNG, State, type Battle, type Pokemon } from '@pkmn/sim';
import { test } from 'vitest';
import { RecordingPRNG } from '../src/dice/prng';
import type { DieName, Draw } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { createRootPosition, type SimPosition } from '../src/forward-model';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, seedOf } from './dice-fixtures';
import { fingerprint } from './power-oracle';
import { dexOfRules, isCharge, type DexMove, type SecondaryEntry } from './dice-sweep-support';
import type { Rules } from './dice-fixtures';
import * as reading from '../src/dice/secondaries';

/**
 * Round 86 (T305), step A4: the support of the red sweep of the secondary classes (`secondary-classes*.spec.ts`).
 *
 * The oracle is the simulator's own turn: a board plays one turn under the dice module's recording PRNG (the module's naming of
 * a draw by the hook, docs/adr/0002), and every die named `secondary` gives its effect id and the chance the draw carried, per
 * target that took damage. The reader and the four class paths are held against that.
 *
 * The contract the rows pin for A5 (a different shape is a change of this file and a line in the gate list):
 * - `secondaryChances(battle, userSlot, moveId, targetSlot)` in `dice/secondaries.ts`: the entries that `ModifyMove` and
 *   `ModifySecondaries` leave with a chance under 1, as `{ effectId, chance }`, in the draw's order.
 * - A singles class key of a hit that does not kill is `hit-nokill+<effect ids that came true, sorted, joined with "+">`; no
 *   token means no effect came. Two sides join with `|` as before. A kill keeps its key. A flinch that cuts the second mover
 *   makes its outcome `none`: `hit-nokill+flinch|none`.
 * - A script answers the die with `secondary: { [effectId]: boolean }` on `RollScript` (key `p1:moveid`) and `PairScript`
 *   (key `p1a:moveid>p2a`).
 * - A pair class key names the event as `<attacker>:<move>><target>=<outcome>` and appends `+<effect id>` for each effect that
 *   came true.
 */

export const FAST = 'Pikachu';

/** `T305_RED=1` runs the rows A5 has not turned green yet as plain tests, so their failures show their reasons. */
export const T305_RED = process.env.T305_RED === '1';

/** The rows that fail today and turn green with A5 (A5 removes each id when its commit turns the row green). */
export const KNOWN = new Set<string>([
  // empty: every row of the T305 specs is a plain test
]);

/** A row: `test.fails` while its id is in KNOWN, a plain test otherwise (and under `T305_RED=1`). */
export const row = (id: string): typeof test => (KNOWN.has(id) && !T305_RED ? test.fails : test) as typeof test;

export interface Chance { effectId: string; chance: number }

/** What the reader owes the rows: the function of A5's first commit, or a failure that says it is not there. */
export type Reader = (battle: Battle, userSlot: string, moveId: string, targetSlot: string) => Chance[];

export function reader(): Reader {
  const fn = (reading as unknown as Record<string, unknown>).secondaryChances;
  if (typeof fn !== 'function') throw new Error('secondaryChances is not exported by dice/secondaries.ts yet (T305, A5 commit 1)');
  return fn as Reader;
}

export const entriesOf = (move: DexMove): SecondaryEntry[] => ((move as unknown as { secondaries?: SecondaryEntry[] }).secondaries ?? []);
export const hasChanceEntry = (move: DexMove): boolean => entriesOf(move).some(entry => entry.chance !== undefined && entry.chance < 100);

const SURE = 1 - 1e-9;
const bySlotAndId = (a: Chance, b: Chance): number => a.effectId.localeCompare(b.effectId);

/** The tolerance of a chance: Gens 1 and 2 draw `n` in 256 for a percent, so the drawn chance is a rounding of the entry's. */
export const toleranceOf = (rules: Rules): number => (rules.generation <= 2 ? 0.02 : 1e-6);

/** The problem when two lists of chances differ, or null. */
export function sameChances(got: readonly Chance[], want: readonly Chance[], tolerance: number): string | null {
  const a = [...got].sort(bySlotAndId);
  const b = [...want].sort(bySlotAndId);
  const show = (list: readonly Chance[]): string => list.map(entry => `${entry.effectId}@${entry.chance.toFixed(4)}`).join(',') || 'none';
  if (a.length !== b.length) return `reader ${show(a)}, simulator ${show(b)}`;
  const off = a.findIndex((entry, index) => entry.effectId !== b[index].effectId || Math.abs(entry.chance - b[index].chance) > tolerance);
  return off === -1 ? null : `reader ${show(a)}, simulator ${show(b)}`;
}

const bodiesOf = (battle: Battle): Pokemon[] => battle.sides.flatMap(side => side.active.filter((body): body is Pokemon => !!body));

/** The reader on a board, with `fingerprint` before and after: the live battle must not change. */
export function readOn(board: Battle, moveId: string, targetSlot: string): { chances: Chance[]; unchanged: boolean } {
  const before = fingerprint(board, bodiesOf(board), moveId);
  const chances = reader()(board, 'p1a', moveId, targetSlot);
  return { chances, unchanged: fingerprint(board, bodiesOf(board), moveId) === before };
}

/** The chance of a recorded draw: the chance the hook's entry carried (Gens 3 and up) or the draw's own fraction (Gens 1 and 2). */
const chanceOfDraw = (draw: { chance?: number; numerator?: number; from?: number }): number =>
  draw.chance ?? (draw.numerator ?? Number.NaN) / (draw.from ?? Number.NaN);

/** A recording stream that keeps every secondary draw with its chance (two entries with one effect id, a move's own flinch and a King's Rock's, are two dice). */
class CountingPRNG extends RecordingPRNG {
  readonly secondaries: { name: DieName; chance: number }[] = [];

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    if (name.kind === 'secondary') this.secondaries.push({ name, chance: chanceOfDraw(draw) });
    return super.decide(name, draw, natural);
  }
}

/**
 * The simulator's secondary dice per target that took damage: the board plays one turn per seed on a copy (the board stays at its
 * turn) until every slot in `slots` has been hit once or the seeds run out. A hit slot with no secondary die maps to an empty list.
 * A multi-hit move draws its entries at every hit; `perHit` keeps each effect and chance once, as the reader lists the move's entries once.
 */
export function playedChances(board: Battle, clicks: { p1: string; p2: string }, slots: readonly string[], perHit = false, seeds = 12): Map<string, Chance[]> {
  const found = new Map<string, Chance[]>();
  for (let index = 0; index < seeds && found.size < slots.length; index++) {
    const copy = copyOf(board);
    (copy as unknown as { debugMode: boolean }).debugMode = false;
    const stream = new PRNG(seedOf(index + 1) as never);
    const watch = watchBattle(copy);
    const recording = new CountingPRNG(stream, watch);
    copy.prng = recording;
    try {
      playClicks(copy, clicks);
    } finally {
      watch.uninstall();
    }
    for (const slot of slots) {
      if (found.has(slot) || !copy.log.some(line => line.startsWith(`|-damage|${slot}:`) && !line.includes('[from]'))) continue;
      const seen: Chance[] = [];
      for (const { name, chance } of recording.secondaries) {
        if (name.targetSlot !== slot || chance >= SURE) continue;
        const effectId = name.effectId ?? 'effect';
        if (!perHit || !seen.some(entry => entry.effectId === effectId && entry.chance === chance)) seen.push({ effectId, chance });
      }
      found.set(slot, seen);
    }
  }
  return found;
}

/** A board one turn after a charge move began, with the clicks that finish it; the board itself for any other move. */
export function liveOf(board: Battle, move: DexMove, clicks: { p1: string; p2: string }, locked: { p1: string; p2: string }): { live: Battle; clicks: { p1: string; p2: string } } {
  if (!isCharge(move)) return { live: board, clicks };
  const live = copyOf(board);
  live.prng ??= board.prng.clone();
  playClicks(live, clicks);
  return { live, clicks: locked };
}

/** The abilities and items of a rule set whose Dex entry has a handler that can touch a move's secondaries or its entries. */
export function handlerHolders(rules: Rules, kind: 'abilities' | 'items'): string[] {
  const dex = dexOfRules(rules);
  const handled = (entry: object): boolean =>
    ['onModifyMove', 'onModifySecondaries'].some(handler => typeof (entry as Record<string, unknown>)[handler] === 'function');
  return dex[kind].all()
    .filter(entry => entry.exists && entry.gen <= dex.gen && (entry.isNonstandard === null || entry.isNonstandard === undefined) && handled(entry))
    .map(entry => entry.name);
}

/** The root position of a battle, as the engine's paths read it. */
export const rootOf = (board: Battle): SimPosition => createRootPosition(JSON.stringify(State.serializeBattle(board)));

/** The analytic classes of a hit that cannot kill: the miss, and the hit split by every subset of the entries that came true. */
export function expectedClasses(accuracy: number, entries: readonly Chance[]): Map<string, number> {
  const classes = new Map<string, number>();
  if (accuracy < 1) classes.set('miss', 1 - accuracy);
  for (let mask = 0; mask < 1 << entries.length; mask++) {
    let weight = accuracy;
    const came: string[] = [];
    entries.forEach((entry, index) => {
      if (mask & (1 << index)) {
        weight *= entry.chance;
        came.push(entry.effectId);
      } else {
        weight *= 1 - entry.chance;
      }
    });
    if (weight > 1e-9) classes.set(['hit-nokill', ...came.sort()].join('+'), weight);
  }
  return classes;
}

/** Classes under this mass may be dropped by a path (the pair plan's `MIN_MASS`). */
export const MIN_MASS = 0.01;

/**
 * The problems when a path's class weights differ from the chances: every expected class of mass `MIN_MASS` or more is there at
 * its weight (within the mass the path may have dropped), no class is unexpected, and the weights sum to 1 less what was dropped.
 */
export function weightProblems(got: ReadonlyMap<string, number>, want: ReadonlyMap<string, number>, tolerance = 1e-6): string[] {
  const dropped = [...want.values()].filter(weight => weight < MIN_MASS).reduce((sum, weight) => sum + weight, 0);
  const problems: string[] = [];
  for (const [key, weight] of want) {
    if (weight < MIN_MASS) continue;
    const seen = got.get(key);
    if (seen === undefined) problems.push(`missing class ${key} (${weight.toFixed(4)})`);
    else if (Math.abs(seen - weight) > dropped + tolerance) problems.push(`class ${key}: ${seen.toFixed(4)}, chance ${weight.toFixed(4)}`);
  }
  for (const key of got.keys()) if (!want.has(key)) problems.push(`unexpected class ${key}`);
  const total = [...got.values()].reduce((sum, weight) => sum + weight, 0);
  if (total > 1 + tolerance || total < 1 - dropped - tolerance) problems.push(`the weights sum to ${total.toFixed(4)}`);
  return problems;
}
