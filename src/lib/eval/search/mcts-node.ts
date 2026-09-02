import type { MatchupCache } from '../eval-function';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model';
import { cellKey } from '../rank';
import type { EvalSettings, TeraAllowance } from '../types';
import { leafValue } from './leaf';
import { optionHints } from './hints';
import { searchOptions } from './options';

/**
 * The MCTS node machinery: node creation over the shared option lists and
 * the static leaf value, the decoupled UCB pick under progressive
 * widening, the principal variation, and the tree-informed root matrix.
 */

const EXPLORATION = 0.8;
const PV_MIN_VISITS = 8;
const PV_MAX_STEPS = 3;

/**
 * Progressive widening: a node exposes only its strongest-by-hint unvisited
 * options, and the window grows with the node's visits. The old rule forced
 * EVERY unvisited option through a real visit first — on the doubles 16×16
 * root that sweep ate the 600 iterations before UCB could discriminate
 * (measured doubles −3 vs the matrix on the 2026-08-11 corpus). Hints are
 * static (optionHints — the restriction's own ranking), so ordering stays
 * deterministic; the window still reaches every option asymptotically.
 */
export const WIDENING_BASE = 4;
export const WIDENING_VISITS_PER_SLOT = 8;
export const wideningWindow = (count: number, visits: number): number =>
  Math.min(count, WIDENING_BASE + Math.floor(visits / WIDENING_VISITS_PER_SLOT));

/** Hint-descending option order (ties keep list order — deterministic). */
const hintOrder = (hints: number[]): number[] =>
  hints.map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(entry => entry.index);

export interface Node {
  position: SimPosition;
  ended: boolean;
  /** Static eval, p1 perspective. */
  value: number;
  p1Options: ChoiceOption[];
  p2Options: ChoiceOption[];
  p1N: number[];
  p1W: number[];
  p2N: number[];
  p2W: number[];
  /** Hint-descending expansion order per side (indices into the option lists). */
  p1Order: number[];
  p2Order: number[];
  visits: number;
  children: Map<number, Node>;
}

export function makeNode(
  position: SimPosition,
  tera: TeraAllowance,
  matchupCache: MatchupCache,
  keepPlayed?: EvalSettings['keepPlayed'],
  sleepClause?: boolean,
): Node {
  const battle = positionBattle(position);
  const ended = battle.ended;
  const p1Options = ended ? [] : searchOptions(position, 'p1', { tera, keep: keepPlayed?.p1Slots, sleepClause });
  const p2Options = ended ? [] : searchOptions(position, 'p2', { tera, keep: keepPlayed?.p2Slots, sleepClause });
  return {
    position,
    ended,
    // Same wp-unit value space as the matrix mode — mode switches must not
    // change what a number means.
    value: leafValue(battle, matchupCache),
    p1Options,
    p2Options,
    p1N: new Array(p1Options.length).fill(0),
    p1W: new Array(p1Options.length).fill(0),
    p2N: new Array(p2Options.length).fill(0),
    p2W: new Array(p2Options.length).fill(0),
    p1Order: hintOrder(ended || p1Options.length === 0 ? [] : optionHints(position, 'p1', p1Options)),
    p2Order: hintOrder(ended || p2Options.length === 0 ? [] : optionHints(position, 'p2', p2Options)),
    visits: 0,
    children: new Map(),
  };
}

/**
 * UCB pick over one side's decoupled stats. Unvisited options still come
 * first, but only inside the progressive-widening window and best hint
 * first — weak options beyond the window stay closed until the node has
 * earned the visits to afford them.
 */
export function pick(n: number[], w: number[], visits: number, maximize: boolean, order: number[]): number {
  const window = wideningWindow(n.length, visits);
  let best = -1;
  let bestScore = -Infinity;
  for (let rank = 0; rank < order.length; rank++) {
    const index = order[rank];
    if (n[index] === 0) {
      if (rank < window) return index;
      continue;
    }
    const mean = w[index] / n[index];
    const exploit = maximize ? mean : -mean;
    const score = exploit + EXPLORATION * Math.sqrt(Math.log(visits + 1) / n[index]);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

export function principalVariation(node: Node): { p1: string; p2: string }[] {
  const steps: { p1: string; p2: string }[] = [];
  let current = node;
  for (let step = 0; step < PV_MAX_STEPS; step++) {
    if (current.ended || current.p1Options.length === 0 || current.p2Options.length === 0) break;
    let bestKey = -1;
    let bestVisits = 0;
    let bestI = 0;
    let bestJ = 0;
    for (const [key, child] of current.children) {
      if (child.visits > bestVisits) {
        bestVisits = child.visits;
        bestKey = key;
        bestI = Math.floor(key / 10_000);
        bestJ = key % 10_000;
      }
    }
    if (bestKey < 0 || bestVisits < PV_MIN_VISITS) break;
    steps.push({ p1: current.p1Options[bestI].label, p2: current.p2Options[bestJ].label });
    current = current.children.get(bestKey)!;
  }
  return steps;
}

/**
 * Tree-informed root cell: the mean of every leaf value backed through the
 * cell (a child's own p1W marginals sum to its pass-through reward; its
 * creation-time static covers the expansion pass) blended with ONE extra
 * static-prior visit — the selection-over-noise guard, so a single wild
 * playout cannot own a cell. Unexpanded cells fall back to the root static.
 */
function treeCellValue(root: Node, i: number, j: number): number {
  const child = root.children.get(cellKey(i, j));
  if (!child) return root.value;
  const total = child.p1W.reduce((sum, w) => sum + w, 0) + child.value;
  return (total + child.value) / (child.visits + 1);
}

/** Most-visited index (ties keep the lower index — the old rank order). */
export function topVisitedIndex(n: number[]): number {
  let best = -1;
  let bestN = 0;
  for (let index = 0; index < n.length; index++) {
    if (n[index] > bestN) {
      bestN = n[index];
      best = index;
    }
  }
  return best;
}

/** The tree-informed root matrix: cell values from the tree, ended flags from the expanded children. */
export function treeMatrix(root: Node): { values: number[][]; ended: boolean[][] } {
  const values = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => treeCellValue(root, i, j)));
  const ended = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => root.children.get(cellKey(i, j))?.ended ?? false));
  return { values, ended };
}
