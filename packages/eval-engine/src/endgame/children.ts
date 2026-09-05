import type { Battle, PRNGSeed } from '@pkmn/sim';
import { advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import {
  BOUNDARY_DRAW_BUDGET, classifyChild, foldClassWeights, observeOrder, planCellEvents, PROBE_SEEDS, type CellEvent,
} from '../cell-blend.ts';
import { SEARCH_SEEDS } from '../search/leaf.ts';
import { effectiveSpeed } from '../speed.ts';

/**
 * One matrix cell's children for the endgame solver (round 34): chance
 * priced as outcome classes with analytic weights, one representative
 * child per class (the draw whose damage sits closest to the class mean),
 * and a plain median child where no class plan exists. A cell whose
 * draws disagree on a KO the plan could not price flags `unpriced`.
 * Round 35: `share` keeps the analytic weight for the prover, `plain`
 * marks the median path.
 */
interface EndgameChild {
  position: SimPosition;
  /** Weight normalized over the drawn classes (the solver's blend). */
  weight: number;
  /** Analytic class weight before that normalization (the prover's mass); 1 on the plain path. */
  share: number;
  ended: boolean;
  /** Group key `${order}:${classKey}` on the class path; absent on the plain path. */
  key?: string;
}
export interface EndgameChildren {
  children: EndgameChild[];
  unpriced: boolean;
  /** True when the plain (median) path ran. */
  plain: boolean;
  /** Plain path only: the draws disagreed on damage, faints, or the end (chance moved the cell). */
  spread: boolean;
}

interface Draw { position: SimPosition; log: string[]; ended: boolean; measure: number; fainted: number }

type Order = 'p1' | 'p2';

const PLAIN_DRAWS = 3;

const totalHp = (battle: Battle): number =>
  battle.sides.reduce((sum, side) => sum + side.pokemon.reduce((hp, pokemon) => hp + pokemon.hp, 0), 0);
const totalFainted = (battle: Battle): number =>
  battle.sides.reduce((sum, side) => sum + side.pokemon.filter(pokemon => pokemon.fainted).length, 0);

/** The move id a singles choice names, or null for switches and combined choices. */
function moveIdOf(choice: string): string | null {
  const tokens = choice.split(' > ')[0].trim().split(/\s+/);
  return tokens[0] === 'move' && tokens[1] && !choice.includes(',') ? tokens[1] : null;
}

function drawChild(root: SimPosition, rootHp: number, p1Choice: string, p2Choice: string, seed: PRNGSeed): Draw {
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed);
  const battle = positionBattle(child);
  return { position: child, log, ended: battle.ended, measure: rootHp - totalHp(battle), fainted: totalFainted(battle) };
}

/** The draw whose damage measure sits closest to the group's mean; ties keep the earliest draw. */
function nearestMean(draws: Draw[]): Draw {
  const mean = draws.reduce((sum, draw) => sum + draw.measure, 0) / draws.length;
  let best = draws[0];
  for (const draw of draws) if (Math.abs(draw.measure - mean) < Math.abs(best.measure - mean)) best = draw;
  return best;
}

/** The median draw by damage measure (the middle one of a sorted copy). */
function median(draws: Draw[]): Draw {
  const sorted = [...draws].sort((a, b) => a.measure - b.measure);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Whether either choice names a damaging move (base power, fixed damage, or OHKO). */
function damagingPair(battle: Battle, p1Choice: string, p2Choice: string): boolean {
  return [p1Choice, p2Choice].some(choice => choice.split(',').some(part => {
    const tokens = part.trim().split(' ');
    if (tokens[0] !== 'move') return false;
    const move = battle.dex.moves.get(tokens[1]);
    return move.exists && (move.basePower > 0 || Boolean(move.damage) || Boolean(move.ohko));
  }));
}

/** Singles only: both sides act with moves of equal priority at equal effective speed. */
function speedTie(battle: Battle, p1Choice: string, p2Choice: string): boolean {
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

/** Expected group weights: order classes (one half each on a tie) times the boundary classes per order. */
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

/** Books every draw into its expected group; null when one draw fits none. */
function bookDraws(
  draws: Draw[], expected: Map<string, number>, events: CellEvent[], tie: boolean, order: Order | null,
): Map<string, Draw[]> | null {
  const grouped = new Map<string, Draw[]>();
  for (const draw of draws) {
    const key = groupOf(draw, events, tie, order);
    if (key === null || !expected.has(key)) return null;
    grouped.set(key, [...(grouped.get(key) ?? []), draw]);
  }
  return grouped;
}

/** The class path: null when any draw falls outside the plan (the caller takes the plain path). */
function classChildren(
  root: SimPosition, rootHp: number, events: CellEvent[], p1Choice: string, p2Choice: string, tie: boolean, drawBudget: number,
): EndgameChildren | null {
  const draws: Draw[] = SEARCH_SEEDS.map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed));
  const order = tie ? null : (events.length > 0 ? observeOrder(draws.map(draw => draw.log), events) : 'p1');
  if (!tie && order === null) return null;
  const expected = expectedGroups(events, tie ? ['p1', 'p2'] : [order!]);
  // Probe draws chase the classes the base draws never showed, within the
  // boundary budget the root blend uses.
  let probe = 0;
  let grouped = bookDraws(draws, expected, events, tie, order);
  while (grouped && [...expected.keys()].some(key => !grouped!.has(key)) && draws.length < drawBudget && probe < PROBE_SEEDS.length) {
    draws.push(drawChild(root, rootHp, p1Choice, p2Choice, PROBE_SEEDS[probe++]));
    grouped = bookDraws(draws, expected, events, tie, order);
  }
  if (!grouped) return null;
  const present = [...expected].filter(([key]) => grouped!.has(key));
  const weightTotal = present.reduce((sum, [, weight]) => sum + weight, 0);
  const children = present.map(([key, weight]) => {
    const pick = nearestMean(grouped!.get(key)!);
    return { position: pick.position, weight: weight / weightTotal, share: weight, ended: pick.ended, key };
  });
  return { children, unpriced: present.length < expected.size, plain: false, spread: false };
}

/** The plain path: the median of three draws for damaging pairs, one draw otherwise. */
function plainChildren(root: SimPosition, battle: Battle, rootHp: number, p1Choice: string, p2Choice: string): EndgameChildren {
  const count = damagingPair(battle, p1Choice, p2Choice) ? PLAIN_DRAWS : 1;
  const draws = SEARCH_SEEDS.slice(0, count).map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed));
  const pick = median(draws);
  const unpriced = draws.some(draw => draw.fainted !== draws[0].fainted || draw.ended !== draws[0].ended);
  const spread = unpriced || draws.some(draw => draw.measure !== draws[0].measure);
  return { children: [{ position: pick.position, weight: 1, share: 1, ended: pick.ended }], unpriced, plain: true, spread };
}

/**
 * `drawBudget` caps the draws a class cell may take chasing classes the base
 * draws never showed (the root blend's BOUNDARY_DRAW_BUDGET by default, the
 * solver's exactness; the prover passes less and leaves rare classes open).
 */
export function endgameChildren(root: SimPosition, p1Choice: string, p2Choice: string, drawBudget = BOUNDARY_DRAW_BUDGET): EndgameChildren {
  const battle = positionBattle(root);
  const rootHp = totalHp(battle);
  const plan = planCellEvents(battle, p1Choice, p2Choice);
  const tie = speedTie(battle, p1Choice, p2Choice);
  if (plan.kind === 'events' || (plan.kind === 'none' && tie)) {
    const grouped = classChildren(root, rootHp, plan.kind === 'events' ? plan.events : [], p1Choice, p2Choice, tie, drawBudget);
    if (grouped) return grouped;
  }
  return plainChildren(root, battle, rootHp, p1Choice, p2Choice);
}
