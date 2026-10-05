import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank.ts';
import { attachKoOdds, koOddsMapsFor } from './search/root-payload.ts';
import type { CellBlendClass, EvalCellValue, EvalResult, KoOddsMismatch, MctsTreeStats } from './types.ts';
import { cellContribution, pooledChanceValue, type TreeCell } from './search/merge-pool.ts';
import { VERIFY_DISAGREEMENT, VERIFY_MIN_TREES, VERIFY_MIN_VISITS, weightedDisagreement } from './verify-select.ts';

// Round 63: the verify cell selection lives in verify-select.ts; its names stay importable from here.
export {
  rowCompletedCells, starvedSupportCells, VERIFY_DISAGREEMENT, VERIFY_SAMPLES, weightedDisagreement,
} from './verify-select.ts';

/**
 * Root parallelization for the MCTS mode: N independent trees (each with a
 * rotated seed offset) run on separate workers and merge here by POOLED
 * root-cell statistics, ranked by the same equilibrium solve the matrix
 * mode runs (visit counts allocate search effort; they are not the
 * verdict). Verification re-prices the suspect cells the solve leans on
 * and keeps the pool's depth where the pool has played a cell out
 * (verifiedValue). Pure —
 * rank.ts and the sim-free payload helpers only, no sim imports,
 * main-thread safe.
 */

/**
 * Fixed tree count. Machine-independent on purpose: results must not vary
 * with a machine's worker-pool size. Pools smaller than this simply run
 * trees in successive rounds.
 */
export const MCTS_TREES = 4;

/**
 * A pool whose continuation has reached this magnitude has played the cell
 * out to a (near-)terminal verdict; only there does the tree's depth
 * outrank the sampler's one-ply static (573756 t138: −0.94 to −0.99 over
 * 490 to 760 visits against statics near zero). Below it a rich pool is a
 * middlegame mean over exploration, not a verdict, and the round-7 sampler
 * stands (655336 t24: 528 visits agreed at +0.52 while the static read
 * +0.08, and the tree's number regraded a fine Dragon Dance as a blunder).
 */
const VERIFY_DEPTH_FLOOR = 0.9;

interface PooledCell {
  visits: number;
  total: number;
  value: number;
  ended: boolean;
  /** Round 43: the per-tree cells, for the per-class pool of chance cells. */
  cells: TreeCell[];
}

/**
 * Pool per-cell reward totals across trees; ONE static prior per cell (the
 * per-tree results already carry it, the pool re-applies it once).
 */
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

/**
 * The pool's continuation for one root cell: the trees whose drawn child
 * did not end the game, pooled with each tree's own prior, plus the visit
 * count, the number of such trees, and the visit-weighted disagreement
 * of their per-tree means. With `classKey` only the trees that drew that
 * outcome class count (round 33); `acceptUnkeyed` lets trees without a
 * recorded class join (the one-open-class shape, where every open draw
 * must belong to that class). Round 43: a chance cell (cells[].classes)
 * contributes the pool of the named class itself (merge-pool.ts).
 */
function poolContinuation(
  trees: MctsTreeStats[], key: number, classKey?: string, acceptUnkeyed = false,
): { value: number; visits: number; trees: number; disagreement: number } {
  let total = 0;
  let weight = 0;
  let visits = 0;
  const entries: { mean: number; weight: number }[] = [];
  for (const tree of trees) {
    const own = cellContribution(tree.cells.find(entry => entry.key === key), classKey, acceptUnkeyed);
    if (!own) continue;
    total += own.mean * own.weight;
    weight += own.weight;
    visits += own.visits;
    entries.push({ mean: own.mean, weight: own.weight });
  }
  return { value: weight > 0 ? total / weight : NaN, visits, trees: entries.length, disagreement: weightedDisagreement(entries) };
}

/** A class pool rich enough to carry depth: VERIFY_MIN_VISITS visits over at least two trees (four trees split across classes). */
const VERIFY_MIN_CLASS_TREES = 2;

/** A pool that has played its cell out and agrees: its depth outranks the one-ply sampler. */
function deepPool(pool: ReturnType<typeof poolContinuation>, minTrees: number): boolean {
  return pool.visits >= VERIFY_MIN_VISITS && pool.trees >= minTrees &&
    pool.disagreement <= VERIFY_DISAGREEMENT && Math.abs(pool.value) >= VERIFY_DEPTH_FLOOR;
}

/**
 * The value a verified cell contributes (rounds 32 and 33). The sampler's
 * job is the ROOT chance split; the trees' job is depth, and depth counts
 * only where the pool has played the cell out (VERIFY_DEPTH_FLOOR) and
 * agrees. Without a blend a rich, agreeing, played-out pool stands and
 * everything else takes the sampler's value (round 7). With a blend every
 * class is priced on its own (round 33): an ended class contributes its
 * exact leaves; an open class takes the pool of the trees that DREW that
 * class (cells[].classKey) when that pool is deep, and the sampler's class
 * mean otherwise (573756 t137: three trees played the hit out to −0.96
 * while the one miss tree sat at +0.2 — the hit class keeps its depth,
 * the miss class keeps the sampler). Trees without a recorded class join
 * a pool only in the one-open-class shape, where every open draw must
 * belong to that class (round 32's rule as the special case). Round 63
 * (T16): the verify step takes every open class one ply deeper
 * (cls.deepened) and a plain cell's outcome groups mixed by share
 * (cell.deepened), so no verified cell mixes depths.
 */
function verifiedValue(trees: MctsTreeStats[], key: number, cell: EvalCellValue, pooledValue: number): number {
  if (!cell.blend) {
    const pool = poolContinuation(trees, key);
    // The sampler's value, one ply deeper where the verify step deepened it (round 33).
    return deepPool(pool, Math.min(VERIFY_MIN_TREES, trees.length)) ? pooledValue : cell.deepened ?? cell.value;
  }
  const { blend } = cell;
  // A class one ply deeper (round 63); otherwise a deepened first-seed child
  // re-blends inside its class only (reblendValue's rule, values from before).
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
    value += cls.weight * (deepPool(pool, VERIFY_MIN_CLASS_TREES) ? pool.value : classMean(cls));
  }
  return value;
}

/**
 * The pooled root matrix. `verified` (cellKey → sampled cell) re-prices the
 * suspect cells before the solve: a starved cell takes the multi-seed
 * matrix-grade mean (it outranks the 1-2 chance outcomes the tree happened
 * to draw there), a played-out pool keeps its depth (verifiedValue).
 */
function pooledMatrix(
  base: MctsTreeStats,
  pooled: Map<number, PooledCell>,
  verified: Map<number, EvalCellValue> | undefined,
  trees: MctsTreeStats[],
): { values: number[][]; ended: boolean[][] } {
  const values = base.p1Options.map((_, i) => base.p2Options.map((_, j) => {
    const entry = pooled.get(cellKey(i, j));
    if (!entry) return base.rootValue;
    // Round 43: a chance cell pools per class across the trees (merge-pool.ts).
    return pooledChanceValue(entry.cells) ?? (entry.total + entry.value) / (entry.visits + 1);
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

/**
 * Round 7: the verify sampler's mismatch diagnostics survive the merge —
 * sorted (i, j) because the pooled executor returns chunks in completion
 * order. Blend payloads feed verifiedValue (round 32); MCTS has no
 * deepening, so reblendValue has no call site here.
 */
function verifiedDiagnostics(verified: Map<number, EvalCellValue> | undefined): KoOddsMismatch[] {
  return verified
    ? [...verified.values()]
      .map(value => value.diagnostic)
      .filter((diagnostic): diagnostic is KoOddsMismatch => Boolean(diagnostic))
      .sort((a, b) => a.i - b.i || a.j - b.j)
    : [];
}

/**
 * HYBRID SEMANTICS (see mcts.ts toResult): the score keeps the summed
 * visit-mean formulation — bit-comparable with the standing records —
 * while the rankings carry the pooled equilibrium.
 */
function visitMeanScore(trees: MctsTreeStats[], base: MctsTreeStats): { score: number; interval: number } {
  const sum = (key: 'p1N' | 'p1W' | 'p2N' | 'p2W'): number[] =>
    base[key].map((_, index) => trees.reduce((total, tree) => total + (tree[key][index] ?? 0), 0));
  const p1N = sum('p1N');
  const p1W = sum('p1W');
  const p2N = sum('p2N');
  const p2W = sum('p2W');
  const i = topVisitedIndex(p1N);
  const j = topVisitedIndex(p2N);
  const v1 = i >= 0 ? p1W[i] / p1N[i] : base.rootValue;
  const v2 = j >= 0 ? p2W[j] / p2N[j] : base.rootValue;
  return { score: (v1 + v2) / 2, interval: Math.abs(v2 - v1) };
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

/** The follow-up line comes from a tree that agrees on the top choice. */
function attachDonorLine(trees: MctsTreeStats[], result: EvalResult): void {
  if (result.perSide.p1.length > 0) {
    const donor = trees.find(tree =>
      tree.result.perSide.p1[0]?.choice === result.perSide.p1[0].choice && tree.result.perSide.p1[0].line);
    if (donor) result.perSide.p1[0].line = donor.result.perSide.p1[0].line;
  }
}

/**
 * Merges parallel trees into one result. Order of `trees` must be fixed.
 * `verified` (cellKey → sampled cell) re-prices the suspect cells before
 * the solve: a starved cell takes the multi-seed matrix-grade mean, a
 * played-out pool keeps its depth (verifiedValue). The score is untouched by design —
 * it stays the summed-marginal visit mean (hybrid semantics).
 */
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
  // Round 13: the root unanswered profile is tree-invariant — take trees[0]'s.
  if (base.result.unanswered) result.unanswered = base.result.unanswered;

  const { score, interval } = visitMeanScore(trees, base);
  result.score = score;
  result.interval = interval;
  attachDonorLine(trees, result);

  // Round 7: analytic per-option kill odds, shipped by the trees (this
  // module stays sim-free — the shared payload helpers are sim-free too).
  if (base.koOdds) attachKoOdds(result, koOddsMapsFor(base.p1Options, base.p2Options, base.koOdds));
  return result;
}
