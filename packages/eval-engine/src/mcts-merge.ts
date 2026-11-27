import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank.ts';
import { attachKoOdds, koOddsMapsFor } from './search/root-payload.ts';
import type { CellBlendClass, EvalCellValue, EvalMatrix, EvalResult, KoOddsMismatch, MatrixCell, MctsTreeStats, PlannedCell } from './types.ts';
import { cellContribution, keyedCell, type TreeCell } from './search/merge-pool.ts';
import { VERIFY_DISAGREEMENT, VERIFY_MIN_TREES, VERIFY_MIN_VISITS, weightedDisagreement } from './verify-select.ts';

export {
  rowCompletedCells, starvedSupportCells, VERIFY_DISAGREEMENT, VERIFY_SAMPLES, weightedDisagreement,
} from './verify-select.ts';

// Merges N trees by pooled root-cell statistics. Sim-free (rank.ts, payload helpers only): runs on the main thread.

// A pool at this magnitude has played the cell to a near-terminal verdict; below it a rich pool is a middlegame mean.
const VERIFY_DEPTH_FLOOR = 0.9;

// With at most this many living Pokémon per side the trees play to the game's end: a rich agreeing pool is a verdict.
const VERIFY_ENDGAME_LIVING = 2;

const VERIFY_ENDGAME_MIN_VISITS = 100;

const endgameOf = (trees: MctsTreeStats[]): boolean => {
  const living = trees[0]?.living;
  return !!living && living.p1 <= VERIFY_ENDGAME_LIVING && living.p2 <= VERIFY_ENDGAME_LIVING;
};

interface PooledCell {
  visits: number;
  total: number;
  value: number;
  ended: boolean;
  cells: TreeCell[];
}

// Pools per-cell reward totals across trees with ONE static prior per cell: the results carry it, applied once.
function pooledCells(trees: MctsTreeStats[]): Map<number, PooledCell> {
  const pooled = new Map<number, PooledCell>();
  for (const tree of trees) {
    for (const cell of tree.cells) {
      const entry = pooled.get(cell.key);
      if (entry) {
        entry.visits += cell.visits;
        entry.total += cell.total;
        entry.cells.push(cell);
      } else {
        pooled.set(cell.key, { visits: cell.visits, total: cell.total, value: cell.value, ended: cell.ended, cells: [cell] });
      }
    }
  }
  return pooled;
}

function poolContinuation(
  trees: MctsTreeStats[], key: number, classKey?: string, acceptUnkeyed = false,
): { value: number; visits: number; trees: number; disagreement: number; means: number[] } {
  let total = 0;
  let weight = 0;
  let visits = 0;
  const entries: { mean: number; weight: number }[] = [];
  const means: number[] = [];
  for (const tree of trees) {
    const own = cellContribution(tree.cells.find(entry => entry.key === key), classKey, acceptUnkeyed);
    if (!own) continue;
    total += own.mean * own.weight;
    weight += own.weight;
    visits += own.visits;
    entries.push({ mean: own.mean, weight: own.weight });
    if (own.visits >= VERIFY_MIN_VISITS) means.push(own.mean);
  }
  return { value: weight > 0 ? total / weight : NaN, visits, trees: entries.length, disagreement: weightedDisagreement(entries), means };
}

const VERIFY_MIN_CLASS_TREES = 2;

function deepPool(pool: ReturnType<typeof poolContinuation>, minTrees: number, endgame: boolean, sampler: number): boolean {
  if (pool.visits < VERIFY_MIN_VISITS || pool.trees < minTrees) return false;
  const rich = endgame && pool.visits >= VERIFY_ENDGAME_MIN_VISITS;
  if (pool.disagreement > VERIFY_DISAGREEMENT) {
    if (!rich || Math.abs(sampler) >= VERIFY_DEPTH_FLOOR || pool.means.length === 0) return false;
    return sampler < Math.min(...pool.means) || sampler > Math.max(...pool.means);
  }
  return Math.abs(pool.value) >= VERIFY_DEPTH_FLOOR || rich;
}

// The sampler prices the ROOT chance split; a tree's depth counts only where the pool played the cell out and agrees.
function verifiedValue(trees: MctsTreeStats[], key: number, cell: EvalCellValue, pooledValue: number): number {
  const endgame = endgameOf(trees);
  if (!cell.blend) {
    const pool = poolContinuation(trees, key);
    const sampler = cell.deepened ?? cell.value;
    return deepPool(pool, Math.min(VERIFY_MIN_TREES, trees.length), endgame, sampler) ? pooledValue : sampler;
  }
  const { blend } = cell;
  const classMean = (cls: CellBlendClass) => {
    if (cls.deepened !== undefined) return cls.deepened;
    return cell.deepened !== undefined && cls.hasFirst
      ? (cls.leafSum - blend.firstLeaf + cell.deepened) / cls.count
      : cls.leafSum / cls.count;
  };
  const open = blend.classes.filter(cls => !cls.ended);
  let value = 0;
  for (const cls of blend.classes) {
    if (cls.ended) {
      value += cls.weight * classMean(cls);
      continue;
    }
    const pool = poolContinuation(trees, key, cls.key, open.length === 1);
    const sampler = classMean(cls);
    value += cls.weight * (deepPool(pool, VERIFY_MIN_CLASS_TREES, endgame, sampler) ? pool.value : sampler);
  }
  return value;
}

function pooledMatrix(
  base: MctsTreeStats,
  pooled: Map<number, PooledCell>,
  verified: Map<number, EvalCellValue> | undefined,
  trees: MctsTreeStats[],
): { values: number[][]; ended: boolean[][] } {
  const values = base.p1Options.map((_, i) => base.p2Options.map((_, j) => {
    const entry = pooled.get(cellKey(i, j));
    if (!entry) return base.rootValue;
    return keyedCell(entry.cells)?.value ?? (entry.total + entry.value) / (entry.visits + 1);
  }));
  const ended = base.p1Options.map((_, i) =>
    base.p2Options.map((_, j) => pooled.get(cellKey(i, j))?.ended ?? false));
  if (verified) {
    for (const cell of verified.values()) {
      if (cell.i < values.length && cell.j < (values[cell.i]?.length ?? 0)) {
        values[cell.i][cell.j] = verifiedValue(trees, cellKey(cell.i, cell.j), cell, values[cell.i][cell.j]);
        ended[cell.i][cell.j] = cell.ended;
      }
    }
  }
  return { values, ended };
}

/** Behind each cell, index-aligned with `values`: its visits, whether verify re-priced it, its planned answer. */
export function matrixCells(
  rows: number, columns: number, visitsOf: (key: number) => number, verified?: Map<number, EvalCellValue>,
  planned?: PlannedCell[],
): NonNullable<EvalMatrix['cells']> {
  const plans = planned && new Map(planned.map(entry => [entry.key, entry]));
  return Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (_, j): MatrixCell => {
    const key = cellKey(i, j);
    const answer = plans?.get(key);
    return {
      visits: visitsOf(key), verified: verified?.has(key) ?? false,
      ...(plans ? { plan: answer?.plan ?? 'fail' } : {}),
      ...(answer?.classes ? { classes: answer.classes.map(entry => ({ ...entry })) } : {}),
    };
  }));
}

// Sorted by (i, j): the pooled executor returns chunks in completion order.
function verifiedDiagnostics(verified: Map<number, EvalCellValue> | undefined): KoOddsMismatch[] {
  return verified
    ? [...verified.values()]
      .map(value => value.diagnostic)
      .filter((diagnostic): diagnostic is KoOddsMismatch => Boolean(diagnostic))
      .sort((a, b) => a.i - b.i || a.j - b.j)
    : [];
}

// The score stays the summed visit mean (hybrid semantics, mcts.ts toResult); the rankings carry the pooled solve.
function visitMeanScore(trees: MctsTreeStats[], base: MctsTreeStats, pooled: Map<number, PooledCell>): { score: number; interval: number } {
  const sum = (key: 'p1N' | 'p1W' | 'p2N' | 'p2W'): number[] =>
    base[key].map((_, index) => trees.reduce((total, tree) => total + (tree[key][index] ?? 0), 0));
  const p1N = sum('p1N');
  const p1W = sum('p1W');
  const p2N = sum('p2N');
  const p2W = sum('p2W');
  const i = topVisitedIndex(p1N);
  const j = topVisitedIndex(p2N);
  // The top row and column swap a keyed cell's tree totals for its visits at the Dex-weighted value (`N m - T`).
  let fix1 = 0;
  let fix2 = 0;
  for (const [key, entry] of pooled) {
    const onRow = i >= 0 && Math.floor(key / 10_000) === i;
    const onColumn = j >= 0 && key % 10_000 === j;
    if (!onRow && !onColumn) continue;
    const keyed = keyedCell(entry.cells);
    if (!keyed) continue;
    const term = keyed.visits * keyed.value - keyed.total;
    if (onRow) fix1 += term;
    if (onColumn) fix2 += term;
  }
  const v1 = i >= 0 ? (p1W[i] + fix1) / p1N[i] : base.rootValue;
  const v2 = j >= 0 ? (p2W[j] + fix2) / p2N[j] : base.rootValue;
  return { score: (v1 + v2) / 2, interval: Math.abs(v2 - v1) };
}

export type TreeScoreForm = 'visits' | 'game' | 'mix';

const treeScoreEnv = (): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EVAL_TREE_SCORE;

/** The tree score's form, a measurement switch: EVAL_TREE_SCORE under Node, 'visits' otherwise; a typo throws. */
export function treeScoreForm(): TreeScoreForm {
  const raw = treeScoreEnv();
  if (raw === undefined || raw === '') return 'visits';
  if (raw === 'visits' || raw === 'game' || raw === 'mix') return raw;
  throw new Error(`EVAL_TREE_SCORE must be visits, game or mix, got ${raw}`);
}

export function treeScore(visitMean: number, matrixScore: number): number {
  const form = treeScoreForm();
  return form === 'game' ? matrixScore : form === 'mix' ? (visitMean + matrixScore) / 2 : visitMean;
}

/** Most-visited index; ties keep the lower index. */
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

// The line comes from a tree that agrees on the top choice; at a keyed principal cell, the first to draw its top class.
function attachDonorLine(trees: MctsTreeStats[], result: EvalResult, base: MctsTreeStats): void {
  if (result.perSide.p1.length > 0) {
    const top = result.perSide.p1[0].choice;
    const agrees = trees.filter(tree => tree.result.perSide.p1[0]?.choice === top && tree.result.perSide.p1[0].line);
    const i = base.p1Options.findIndex(option => option.choice === top);
    const j = base.p2Options.findIndex(option => option.choice === result.perSide.p2[0]?.choice);
    const key = cellKey(i, j);
    const classOf = (tree: MctsTreeStats) => (i >= 0 && j >= 0 ? tree.cells.find(entry => entry.key === key) : undefined);
    const heaviest = trees.reduce<TreeCell | undefined>((best, tree) => {
      const drawn = classOf(tree);
      return drawn?.classKey !== undefined && drawn.classWeight !== undefined && (!best || drawn.classWeight > best.classWeight!) ? drawn : best;
    }, undefined);
    const donor = (heaviest && agrees.find(tree => classOf(tree)?.classKey === heaviest.classKey)) ?? agrees[0];
    if (donor) result.perSide.p1[0].line = donor.result.perSide.p1[0].line;
  }
}

/** Merges parallel trees (in a fixed order) into one result; `verified` re-prices the suspect cells first. */
export function mergeMctsTrees(trees: MctsTreeStats[], verified?: Map<number, EvalCellValue>): EvalResult {
  const base = trees[0];
  if (trees.length === 1 && !verified) return base.result;

  const pooled = pooledCells(trees);
  const { values, ended } = pooledMatrix(base, pooled, verified, trees);
  const diagnostics = verifiedDiagnostics(verified);

  const ranked = rankFromMatrix(
    { p1Options: base.p1Options, p2Options: base.p2Options, values, ended },
    base.rootValue,
  );
  const result = rankedToResult(ranked, Math.max(...trees.map(tree => tree.depth)));
  if (diagnostics.length > 0) result.koDiagnostics = diagnostics;
  if (result.matrix) {
    result.matrix.cells = matrixCells(base.p1Options.length, base.p2Options.length, key => pooled.get(key)?.visits ?? 0, verified, base.plannedCells);
  }
  // The root unanswered profile and the played order bound are tree-invariant: take trees[0]'s.
  if (base.result.unanswered) result.unanswered = base.result.unanswered;
  if (base.result.playedBounds) result.playedBounds = base.result.playedBounds;

  const { score, interval } = visitMeanScore(trees, base, pooled);
  result.score = treeScore(score, result.score);
  result.interval = interval;
  attachDonorLine(trees, result, base);

  if (base.koOdds) attachKoOdds(result, koOddsMapsFor(base.p1Options, base.p2Options, base.koOdds));
  return result;
}
