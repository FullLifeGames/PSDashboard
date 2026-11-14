import type { MatchupCache } from '../eval-function.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { cellKey } from '../rank.ts';
import type { EvalSettings, MctsTreeStats, RowLines, TeraAllowance, TreeLineStep } from '../types.ts';
import { leafValue } from './leaf.ts';
import { optionHints } from './hints.ts';
import { searchOptions } from './options.ts';

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
  /** Names the node as a decision node (the tree holds no other kind). */
  kind: 'decision';
  position: SimPosition;
  ended: boolean;
  /**
   * Round 42: a turn boundary (or game end) against a mid-turn node at an
   * open forced-switch request, where one side picks its replacement and
   * the other waits. Depth counts boundaries only.
   */
  boundary: boolean;
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
  boundary = true,
): Node {
  const battle = positionBattle(position);
  const ended = battle.ended;
  const p1Options = ended ? [] : searchOptions(position, 'p1', { tera, keep: keepPlayed?.p1Slots, sleepClause });
  const p2Options = ended ? [] : searchOptions(position, 'p2', { tera, keep: keepPlayed?.p2Slots, sleepClause });
  return {
    kind: 'decision',
    position,
    ended,
    boundary,
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

/** The most visited cell of a node (the first of equals): its key and child, null below the visits a line needs. */
function heaviestCell(node: Node): { key: number; child: Node } | null {
  let best: Node | undefined;
  let bestVisits = 0;
  let bestKey = 0;
  for (const [key, child] of node.children) {
    if (child.visits > bestVisits) {
      bestVisits = child.visits;
      best = child;
      bestKey = key;
    }
  }
  return best && bestVisits >= PV_MIN_VISITS ? { key: bestKey, child: best } : null;
}

const hasChoices = (node: Node): boolean => !node.ended && node.p1Options.length > 0 && node.p2Options.length > 0;

const stepAt = (node: Node, key: number, child: Node): TreeLineStep => ({
  p1: node.p1Options[Math.floor(key / 10_000)].label, p2: node.p2Options[key % 10_000].label, visits: child.visits,
});

/**
 * Round 89 (#104): the line the tree holds from one cell of `root` on: the cell itself, then each node's most visited cell while it has
 * `PV_MIN_VISITS` visits, at most `PV_MAX_STEPS` steps in all. Each step names both sides' choices by label (the labels survive the
 * bench order, the choice strings below the root do not translate) and the visits of its cell. Without a first cell the line starts
 * at `root`'s own most visited cell, the principal variation.
 */
export function lineFrom(root: Node, first?: number): TreeLineStep[] {
  const steps: TreeLineStep[] = [];
  let current: Node = root;
  let pick: { key: number; child: Node } | null = null;
  if (first !== undefined) {
    const child = root.children.get(first);
    if (!child || child.visits < PV_MIN_VISITS) return steps;
    pick = { key: first, child };
  }
  for (let step = 0; step < PV_MAX_STEPS; step++) {
    if (!hasChoices(current)) break;
    pick ??= heaviestCell(current);
    if (!pick) break;
    steps.push(stepAt(current, pick.key, pick.child));
    current = pick.child;
    pick = null;
  }
  return steps;
}

export function principalVariation(node: Node): { p1: string; p2: string }[] {
  return lineFrom(node).map(({ p1, p2 }) => ({ p1, p2 }));
}

/** The answers a row keeps a line against: the tree's own top three of the other side. */
const LINE_ANSWERS = 3;

interface RowCell { key: number; visits: number }
type Side = 'p1' | 'p2';
/** What the walk knows of one side's rows: each row's first cell, and each row's cells by the column (the other side's row) they meet. */
interface SideCells { first: Map<number, RowCell & { top: boolean }>; byColumn: Map<number, Map<number, RowCell>> }

/** The columns each side's rows meet: the opponent's top answers, in rank order (-1 where the tree holds no such row). */
const answerColumns = (labels: readonly string[], options: { label: string }[]): number[] =>
  labels.slice(0, LINE_ANSWERS).map(label => options.findIndex(option => option.label === label));

/**
 * Each side's rows read from the root's cells: the first cell of a row is the one against the opponent's top row once it has the
 * visits a line needs, else the row's heavier cell (the first of equals).
 */
function sideCells(root: Node, against: Record<Side, number[]>): Record<Side, SideCells> {
  const out: Record<Side, SideCells> = { p1: { first: new Map(), byColumn: new Map() }, p2: { first: new Map(), byColumn: new Map() } };
  for (const [key, child] of root.children) {
    const i = Math.floor(key / 10_000);
    const j = key % 10_000;
    for (const [side, row, column] of [['p1', i, j], ['p2', j, i]] as const) {
      const cell = { key, visits: child.visits, top: column === against[side][0] && child.visits >= PV_MIN_VISITS };
      const was = out[side].first.get(row);
      if (!was || (cell.top && !was.top) || (cell.top === was.top && cell.visits > was.visits)) out[side].first.set(row, cell);
      if (!out[side].byColumn.has(row)) out[side].byColumn.set(row, new Map());
      out[side].byColumn.get(row)!.set(column, cell);
    }
  }
  return out;
}

/**
 * The lines of one row: the first line, then the line against each lower answer whose cell holds the visits a line needs and is not a
 * cell the row already holds a line from. Empty when the first cell gives no line.
 */
function linesOfRow(root: Node, first: RowCell, byColumn: Map<number, RowCell> | undefined, lower: number[]): TreeLineStep[][] {
  const head = lineFrom(root, first.key);
  if (head.length === 0) return [];
  const lines = [head];
  const taken = new Set([first.key]);
  for (const column of lower) {
    const cell = column < 0 ? undefined : byColumn?.get(column);
    if (!cell || cell.visits < PV_MIN_VISITS || taken.has(cell.key)) continue;
    taken.add(cell.key);
    const line = lineFrom(root, cell.key);
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/**
 * Round 89 (#104): the lines of every root row that holds one, by side and row label. A row's first line starts at the cell against
 * the opponent's top row (`tops`: the labels of each side's best rows in this tree's own ranking, best first) when that cell has the
 * visits a line needs, else at the row's most visited cell. Round 89 (G12): the row also keeps a line against the tree's second and
 * third top answer when its cell there holds the visits, so the donors of a row can choose the answer the merged ranking puts first.
 * The first entry of a row is the line the tree always kept; a cell that is already a line of the row is not kept twice. A row whose
 * cells all lack the visits has no line. The walk reads the tree and changes nothing in it.
 */
export function rowLines(root: Node, tops: { p1: readonly string[]; p2: readonly string[] }): RowLines {
  const out: RowLines = { p1: {}, p2: {} };
  if (!hasChoices(root)) return out;
  const against = { p1: answerColumns(tops.p2, root.p2Options), p2: answerColumns(tops.p1, root.p1Options) };
  const cells = sideCells(root, against);
  for (const side of ['p1', 'p2'] as const) {
    const options = side === 'p1' ? root.p1Options : root.p2Options;
    for (const [row, first] of cells[side].first) {
      const lines = linesOfRow(root, first, cells[side].byColumn.get(row), against[side].slice(1));
      if (lines.length > 0 && !(options[row].label in out[side])) out[side][options[row].label] = lines;
    }
  }
  return out;
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
  const total = leavesBacked(child) + child.value;
  return (total + child.value) / (child.visits + 1);
}

const childEnded = (child: Node | undefined): boolean => child?.ended ?? false;

/** The tree-informed root matrix: cell values from the tree, ended flags from the expanded children. */
export function treeMatrix(root: Node): { values: number[][]; ended: boolean[][] } {
  const values = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => treeCellValue(root, i, j)));
  const ended = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => childEnded(root.children.get(cellKey(i, j)))));
  return { values, ended };
}

const leavesBacked = (child: Node): number => child.p1W.reduce((sum, w) => sum + w, 0);

/** One root cell's tree stats for the merge: its visits, the leaves backed through it plus its static prior, and the class the draw showed. */
export function cellStats(key: number, child: Node, classKey?: string, classWeight?: number): MctsTreeStats['cells'][number] {
  return {
    key, visits: child.visits, total: leavesBacked(child) + child.value, value: child.value, ended: child.ended,
    ...(classKey !== undefined ? { classKey } : {}),
    ...(classKey !== undefined && classWeight !== undefined ? { classWeight } : {}),
  };
}
