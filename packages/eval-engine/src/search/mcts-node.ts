import type { MatchupCache } from '../eval-function.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { cellKey } from '../rank.ts';
import type { EvalSettings, MctsTreeStats, RowLines, TeraAllowance, TreeLineStep } from '../types.ts';
import { leafValue } from './leaf.ts';
import { optionHints } from './hints.ts';
import { searchOptions } from './options.ts';


const EXPLORATION = 0.8;
// The summary's ", then ..." prose reads this value, and the feedback corpus pins that prose.
const PV_MIN_VISITS = 8;
/** The visits a cell needs for a row's line: a thinner read of the tree than the principal variation's. */
export const LINE_MIN_VISITS = 4;
const PV_MAX_STEPS = 3;

// Hints are static, so the order is deterministic; forcing every option through a visit would eat a doubles root.
/** Progressive widening: a node exposes its strongest-by-hint unvisited options, the window growing with its visits. */
export const WIDENING_BASE = 4;
export const WIDENING_VISITS_PER_SLOT = 8;
export const wideningWindow = (count: number, visits: number): number =>
  Math.min(count, WIDENING_BASE + Math.floor(visits / WIDENING_VISITS_PER_SLOT));

const hintOrder = (hints: number[]): number[] =>
  hints.map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(entry => entry.index);

export interface Node {
  kind: 'decision';
  position: SimPosition;
  ended: boolean;
  /** A turn boundary or game end, against a mid-turn node at a forced-switch request; depth counts boundaries only. */
  boundary: boolean;
  value: number;
  p1Options: ChoiceOption[];
  p2Options: ChoiceOption[];
  p1N: number[];
  p1W: number[];
  p2N: number[];
  p2W: number[];
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

function heaviestCell(node: Node, min: number): { key: number; child: Node } | null {
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
  return best && bestVisits >= min ? { key: bestKey, child: best } : null;
}

// Best mean (p1's view for both sides) among options with `min` visits and a quarter of the top one's; -1 when none.
function bestOption(n: number[], w: number[], order: number[], maximize: boolean, min: number): number {
  const most = Math.max(0, ...n);
  let best = -1;
  for (const index of order) {
    if (n[index] < min || n[index] * 4 < most) continue;
    if (best < 0) { best = index; continue; }
    const diff = (w[index] / n[index] - w[best] / n[best]) * (maximize ? 1 : -1);
    if (diff > 0 || (diff === 0 && n[index] > n[best])) best = index;
  }
  return best;
}

// The decoupled search spreads visits over near-equal options, so the most visited cell can be worse by its own mean.
function valueCell(node: Node, min: number): { key: number; child: Node } | null {
  const i = bestOption(node.p1N, node.p1W, node.p1Order, true, min);
  const j = bestOption(node.p2N, node.p2W, node.p2Order, false, min);
  const key = i < 0 || j < 0 ? -1 : cellKey(i, j);
  const child = node.children.get(key);
  return child && child.visits >= min ? { key, child } : heaviestCell(node, min);
}

const hasChoices = (node: Node): boolean => !node.ended && node.p1Options.length > 0 && node.p2Options.length > 0;

const stepAt = (node: Node, key: number, child: Node): TreeLineStep => ({
  p1: node.p1Options[Math.floor(key / 10_000)].label, p2: node.p2Options[key % 10_000].label, visits: child.visits,
});

/** The line the tree holds from one cell of `root`: each node's top-visited cell with `min` visits, to PV_MAX_STEPS. */
export function lineFrom(root: Node, first?: number, min: number = PV_MIN_VISITS, byValue = false): TreeLineStep[] {
  const steps: TreeLineStep[] = [];
  let current: Node = root;
  let pick: { key: number; child: Node } | null = null;
  if (first !== undefined) {
    const child = root.children.get(first);
    if (!child || child.visits < min) return steps;
    pick = { key: first, child };
  }
  for (let step = 0; step < PV_MAX_STEPS; step++) {
    if (!hasChoices(current)) break;
    pick ??= byValue ? valueCell(current, min) : heaviestCell(current, min);
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

const LINE_ANSWERS = 3;

interface RowCell { key: number; visits: number }
type Side = 'p1' | 'p2';
interface SideCells { first: Map<number, RowCell & { top: boolean }>; byColumn: Map<number, Map<number, RowCell>> }

const answerColumns = (labels: readonly string[], options: { label: string }[]): number[] =>
  labels.slice(0, LINE_ANSWERS).map(label => options.findIndex(option => option.label === label));

function sideCells(root: Node, against: Record<Side, number[]>, min: number): Record<Side, SideCells> {
  const out: Record<Side, SideCells> = { p1: { first: new Map(), byColumn: new Map() }, p2: { first: new Map(), byColumn: new Map() } };
  for (const [key, child] of root.children) {
    const i = Math.floor(key / 10_000);
    const j = key % 10_000;
    for (const [side, row, column] of [['p1', i, j], ['p2', j, i]] as const) {
      const cell = { key, visits: child.visits, top: column === against[side][0] && child.visits >= min };
      const was = out[side].first.get(row);
      if (!was || (cell.top && !was.top) || (cell.top === was.top && cell.visits > was.visits)) out[side].first.set(row, cell);
      if (!out[side].byColumn.has(row)) out[side].byColumn.set(row, new Map());
      out[side].byColumn.get(row)!.set(column, cell);
    }
  }
  return out;
}

function linesOfRow(root: Node, first: RowCell, byColumn: Map<number, RowCell> | undefined, lower: number[], min: number): TreeLineStep[][] {
  const head = lineFrom(root, first.key, min, true);
  if (head.length === 0) return [];
  const lines = [head];
  const taken = new Set([first.key]);
  for (const column of lower) {
    const cell = column < 0 ? undefined : byColumn?.get(column);
    if (!cell || cell.visits < min || taken.has(cell.key)) continue;
    taken.add(cell.key);
    const line = lineFrom(root, cell.key, min, true);
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** The lines of every root row that holds one, by side and row label; the tree is only read. */
export function rowLines(
  root: Node, tops: { p1: readonly string[]; p2: readonly string[] }, min: number = LINE_MIN_VISITS, floors?: Partial<Record<Side, Record<string, string>>>,
): RowLines {
  const out: RowLines = { p1: {}, p2: {} };
  if (!hasChoices(root)) return out;
  const against = { p1: answerColumns(tops.p2, root.p2Options), p2: answerColumns(tops.p1, root.p1Options) };
  const cells = sideCells(root, against, min);
  for (const side of ['p1', 'p2'] as const) {
    const options = side === 'p1' ? root.p1Options : root.p2Options;
    for (const [row, first] of cells[side].first) {
      const lines = linesOfRow(root, first, cells[side].byColumn.get(row), against[side].slice(1), min);
      if (lines.length > 0 && !(options[row].label in out[side])) out[side][options[row].label] = lines;
    }
  }
  return withFloorLines(root, out, cells, floors, min);
}

function withFloorLines(root: Node, out: RowLines, cells: Record<Side, SideCells>, floors: Partial<Record<Side, Record<string, string>>> | undefined, min: number): RowLines {
  if (!floors) return out;
  const floor: NonNullable<RowLines['floor']> = { p1: {}, p2: {} };
  let kept = false;
  for (const side of ['p1', 'p2'] as const) {
    const own = side === 'p1' ? root.p1Options : root.p2Options;
    const against = side === 'p1' ? root.p2Options : root.p1Options;
    for (const [label, answer] of Object.entries(floors[side] ?? {})) {
      const row = own.findIndex(option => option.label === label);
      const column = against.findIndex(option => option.label === answer);
      const cell = row < 0 || column < 0 ? undefined : cells[side].byColumn.get(row)?.get(column);
      const line = cell && cell.visits >= min ? lineFrom(root, cell.key, min, true) : [];
      if (line.length > 0) {
        floor[side][label] = line;
        kept = true;
      }
    }
  }
  return kept ? { ...out, floor } : out;
}

// The mean of the leaves backed through the cell plus one static-prior visit, so one wild playout cannot own a cell.
function treeCellValue(root: Node, i: number, j: number): number {
  const child = root.children.get(cellKey(i, j));
  if (!child) return root.value;
  const total = leavesBacked(child) + child.value;
  return (total + child.value) / (child.visits + 1);
}

const childEnded = (child: Node | undefined): boolean => child?.ended ?? false;

export function treeMatrix(root: Node): { values: number[][]; ended: boolean[][] } {
  const values = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => treeCellValue(root, i, j)));
  const ended = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => childEnded(root.children.get(cellKey(i, j)))));
  return { values, ended };
}

const leavesBacked = (child: Node): number => child.p1W.reduce((sum, w) => sum + w, 0);

export function cellStats(key: number, child: Node, classKey?: string, classWeight?: number): MctsTreeStats['cells'][number] {
  return {
    key, visits: child.visits, total: leavesBacked(child) + child.value, value: child.value, ended: child.ended,
    ...(classKey !== undefined ? { classKey } : {}),
    ...(classKey !== undefined && classWeight !== undefined ? { classWeight } : {}),
  };
}
