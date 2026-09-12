import type { Battle, PRNGSeed } from '@pkmn/sim';
import { advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import { classifyChild, foldClassWeights, observeOrder, planCellEvents, type CellEvent } from '../cell-blend.ts';
import type { RollScript, RollScripts } from '../forward/scripted-prng.ts';
import { effectiveSpeed } from '../speed.ts';
import { countFainted, rollSensitivePair } from './leaf.ts';

/**
 * Round 43: one cell's children by outcome. The CLASS path prices a
 * singles pair through the root blend's plan (planCellEvents,
 * foldClassWeights): natural draws on the base seeds name the move order
 * and fill the classes they land in, and every class no draw showed is
 * drawn ON DEMAND through a scripted PRNG (miss, median kill roll, median
 * non-kill roll, the other tie order) and confirmed on its log. The
 * EMPIRICAL path (doubles, guarded singles pairs) draws fixed seeds and
 * groups them by who fell. Shared by the MCTS tree's chance nodes, the
 * endgame solver and the prover.
 */

export interface OutcomeChild {
  position: SimPosition;
  /** Group key `${order}:${classKey}` on the class path; the faint signature on the empirical path. */
  key: string;
  /** Normalized over the drawn groups. */
  weight: number;
  /** Analytic weight before that normalization (empirical path: equals weight). */
  share: number;
  ended: boolean;
  /** The draw stopped at a forced-switch request (stopAtForcedSwitch). */
  pendingSwitch: boolean;
}

export interface OutcomeChildren {
  children: OutcomeChild[];
  /** Class path: expected groups no draw reached, with their analytic share. */
  missing: { key: string; share: number }[];
  events: CellEvent[];
  tie: boolean;
}

export interface ClassDrawOptions {
  baseSeeds: readonly PRNGSeed[];
  /** Cap on forced draws per cell, retries included; groups beyond it stay missing. */
  forcedCap: number;
  stopAtForcedSwitch?: boolean;
}

export interface GroupedDrawOptions {
  /** seeds[0] always; the rest only when the first draw fainted someone or the pair carries a roll. */
  seeds: readonly PRNGSeed[];
  stopAtForcedSwitch?: boolean;
}

export interface Draw {
  position: SimPosition;
  log: string[];
  ended: boolean;
  /** HP lost on both sides against the root (the damage measure of the representative pick). */
  measure: number;
  fainted: number;
  pendingSwitch: boolean;
}

type Order = 'p1' | 'p2';
type Outcome = 'miss' | 'hit-kill' | 'hit-nokill' | 'none';

export const totalHp = (battle: Battle): number =>
  battle.sides.reduce((sum, side) => sum + side.pokemon.reduce((hp, pokemon) => hp + pokemon.hp, 0), 0);

/** The move id a singles choice names, or null for switches and combined choices. */
function moveIdOf(choice: string): string | null {
  const tokens = choice.split(' > ')[0].trim().split(/\s+/);
  return tokens[0] === 'move' && tokens[1] && !choice.includes(',') ? tokens[1] : null;
}

export function drawChild(
  root: SimPosition, rootHp: number, p1Choice: string, p2Choice: string, seed: PRNGSeed,
  opts: { stopAtForcedSwitch?: boolean; scripts?: RollScripts } = {},
): Draw {
  const { child, log, pendingSwitch } = advancePositionWithLog(root, p1Choice, p2Choice, seed, opts);
  const battle = positionBattle(child);
  return { position: child, log, ended: battle.ended, measure: rootHp - totalHp(battle), fainted: countFainted(battle), pendingSwitch };
}

/** The draw whose damage measure sits closest to the group's mean; ties keep the earliest draw. */
export function nearestMean(draws: Draw[]): Draw {
  const mean = draws.reduce((sum, draw) => sum + draw.measure, 0) / draws.length;
  let best = draws[0];
  for (const draw of draws) if (Math.abs(draw.measure - mean) < Math.abs(best.measure - mean)) best = draw;
  return best;
}

/** The median draw by damage measure (the middle one of a sorted copy). */
export function median(draws: Draw[]): Draw {
  const sorted = [...draws].sort((a, b) => a.measure - b.measure);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Singles only: both sides act with moves of equal priority at equal effective speed. */
export function speedTie(battle: Battle, p1Choice: string, p2Choice: string): boolean {
  if (battle.gameType !== 'singles') return false;
  const ids = [moveIdOf(p1Choice), moveIdOf(p2Choice)];
  const actives = [battle.sides[0].active[0], battle.sides[1].active[0]];
  if (!ids[0] || !ids[1] || !actives[0] || !actives[1]) return false;
  const priorities = ids.map(id => battle.dex.moves.get(id!).priority);
  return priorities[0] === priorities[1] && effectiveSpeed(actives[0], battle) === effectiveSpeed(actives[1], battle);
}

/** The side whose move line comes first in a draw's log, or null when nobody moved. */
function firstMover(log: string[]): Order | null {
  for (const line of log) {
    if (line.startsWith('|move|p1a:')) return 'p1';
    if (line.startsWith('|move|p2a:')) return 'p2';
  }
  return null;
}

/** Expected group weights: order groups (one half each on a tie) times the classes per order. */
function expectedGroups(events: CellEvent[], orders: Order[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const order of orders) {
    const classes = events.length > 0 ? foldClassWeights(events, order) : new Map([['none', 1]]);
    for (const [key, weight] of classes) groups.set(`${order}:${key}`, weight / orders.length);
  }
  return groups;
}

/** A draw's group key, or null when the draw fits no expected class. */
function groupOf(draw: Draw, events: CellEvent[], tie: boolean, order: Order | null): string | null {
  const first = tie ? firstMover(draw.log) : order;
  if (!first) return null;
  const key = events.length > 0 ? classifyChild(draw.log, events) : 'none';
  return key === null ? null : `${first}:${key}`;
}

/** The roll script that aims a side's move at one outcome; `extreme` takes the edge roll for the retry. */
function scriptFor(event: CellEvent, outcome: Outcome, extreme: boolean): RollScript | null {
  const { normalKillRolls: n, critKillRolls: c } = event.event;
  if (outcome === 'miss') return { hit: false };
  if (outcome === 'hit-nokill') return { hit: true, crit: false, roll: extreme ? 15 : n + Math.floor((16 - n - 1) / 2) };
  if (outcome === 'hit-kill') {
    return n > 0
      ? { hit: true, crit: false, roll: extreme ? 0 : Math.floor((n - 1) / 2) }
      : { hit: true, crit: true, roll: extreme ? 0 : Math.floor((c - 1) / 2) };
  }
  return null; // 'none': the first actor's kill prevents this move
}

/**
 * The scripts that aim a cell at one group key: one script per event side,
 * plus the tie order on the script of the side that should move first
 * (`tieMoves` names each side's move id; null without a tie). Two attempts
 * (median roll, then the edge roll) when a damage roll is involved.
 */
function scriptsFor(groupKey: string, events: CellEvent[], tieMoves: { p1: string; p2: string } | null): RollScripts[] {
  const [order, classKey] = groupKey.split(':') as [Order, string];
  const outcomes = classKey.split('|') as Outcome[];
  const build = (extreme: boolean): RollScripts => {
    const scripts = new Map<string, RollScript>();
    events.forEach((event, index) => {
      const script = scriptFor(event, outcomes[index] ?? 'none', extreme);
      if (script) scripts.set(`${event.side}:${event.moveId}`, script);
    });
    if (tieMoves) {
      const key = `${order}:${tieMoves[order]}`;
      scripts.set(key, { ...(scripts.get(key) ?? {}), first: order });
    }
    return scripts;
  };
  const rolls = outcomes.some(outcome => outcome === 'hit-kill' || outcome === 'hit-nokill');
  return rolls ? [build(false), build(true)] : [build(false)];
}

function push(groups: Map<string, Draw[]>, key: string, draw: Draw): void {
  groups.set(key, [...(groups.get(key) ?? []), draw]);
}

function toChildren(expected: Map<string, number>, grouped: Map<string, Draw[]>, events: CellEvent[], tie: boolean): OutcomeChildren {
  const present = [...expected].filter(([key]) => grouped.has(key));
  const weightTotal = present.reduce((sum, [, weight]) => sum + weight, 0);
  const children = present.map(([key, weight]) => {
    const pick = nearestMean(grouped.get(key)!);
    return { position: pick.position, key, weight: weight / weightTotal, share: weight, ended: pick.ended, pendingSwitch: pick.pendingSwitch };
  });
  const missing = [...expected].filter(([key]) => !grouped.has(key)).map(([key, share]) => ({ key, share }));
  return { children, missing, events, tie };
}

interface ClassCell {
  root: SimPosition;
  rootHp: number;
  p1Choice: string;
  p2Choice: string;
  events: CellEvent[];
  tie: boolean;
  order: Order | null;
  advance: { stopAtForcedSwitch?: boolean };
}

/** Forced draws for every expected group the base draws never reached, within the cap (retries included). */
function forceMissing(cell: ClassCell, expected: Map<string, number>, grouped: Map<string, Draw[]>, forcedCap: number, seed: PRNGSeed): void {
  const tieMoves = cell.tie ? { p1: moveIdOf(cell.p1Choice)!, p2: moveIdOf(cell.p2Choice)! } : null;
  let forced = 0;
  for (const key of expected.keys()) {
    if (grouped.has(key)) continue;
    for (const scripts of scriptsFor(key, cell.events, tieMoves)) {
      if (forced >= forcedCap) return;
      forced += 1;
      const draw = drawChild(cell.root, cell.rootHp, cell.p1Choice, cell.p2Choice, seed, { ...cell.advance, scripts });
      const landed = groupOf(draw, cell.events, cell.tie, cell.order);
      if (landed !== null && expected.has(landed) && !grouped.has(landed)) push(grouped, landed, draw);
      if (grouped.has(key)) break;
    }
  }
}

/**
 * The class path. Null when the pair has no class plan and no speed tie,
 * when no base log shows the move order, or when a natural draw falls
 * outside the plan (the caller takes its plain path, as before).
 */
export function classChildren(root: SimPosition, p1Choice: string, p2Choice: string, opts: ClassDrawOptions): OutcomeChildren | null {
  const battle = positionBattle(root);
  const plan = planCellEvents(battle, p1Choice, p2Choice);
  const tie = speedTie(battle, p1Choice, p2Choice);
  if (plan.kind === 'fail' || (plan.kind === 'none' && !tie)) return null;
  const events = plan.kind === 'events' ? plan.events : [];
  const rootHp = totalHp(battle);
  const advance = { stopAtForcedSwitch: opts.stopAtForcedSwitch };
  const draws = opts.baseSeeds.map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed, advance));
  const order: Order | null = tie ? null : (events.length > 0 ? observeOrder(draws.map(draw => draw.log), events) : 'p1');
  if (!tie && order === null) return null;
  const expected = expectedGroups(events, tie ? ['p1', 'p2'] : [order!]);
  const grouped = new Map<string, Draw[]>();
  for (const draw of draws) {
    const key = groupOf(draw, events, tie, order);
    if (key === null || !expected.has(key)) return null;
    push(grouped, key, draw);
  }
  forceMissing({ root, rootHp, p1Choice, p2Choice, events, tie, order, advance }, expected, grouped, opts.forcedCap, opts.baseSeeds[0]);
  return toChildren(expected, grouped, events, tie);
}

/** The faint signature of a draw: who fell, and whether the game ended. */
function signature(draw: Draw): string {
  const faints = draw.log.filter(line => line.startsWith('|faint|')).map(line => line.slice('|faint|'.length)).sort();
  return `${faints.join(',')}${draw.ended ? '|end' : ''}`;
}

/**
 * The empirical path for pairs without a class plan (doubles, guarded
 * singles pairs): seeds[0] always, the remaining seeds when that draw
 * fainted someone or the pair carries an accuracy or random-call roll
 * (plainCellSample's rule), grouped by faint signature with the median
 * draw as representative. Weights are draw shares.
 */
export function groupedChildren(root: SimPosition, p1Choice: string, p2Choice: string, opts: GroupedDrawOptions): OutcomeChildren {
  const battle = positionBattle(root);
  const rootHp = totalHp(battle);
  const rootFainted = countFainted(battle);
  const advance = { stopAtForcedSwitch: opts.stopAtForcedSwitch };
  const draws = [drawChild(root, rootHp, p1Choice, p2Choice, opts.seeds[0], advance)];
  if (draws[0].fainted > rootFainted || rollSensitivePair(battle, p1Choice, p2Choice)) {
    for (const seed of opts.seeds.slice(1)) draws.push(drawChild(root, rootHp, p1Choice, p2Choice, seed, advance));
  }
  const groups = new Map<string, Draw[]>();
  for (const draw of draws) push(groups, signature(draw), draw);
  const children = [...groups.entries()].map(([key, list]) => {
    const pick = median(list);
    const weight = list.length / draws.length;
    return { position: pick.position, key, weight, share: weight, ended: pick.ended, pendingSwitch: pick.pendingSwitch };
  });
  return { children, missing: [], events: [], tie: false };
}
