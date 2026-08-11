import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank';
import type { EvalResult, MctsTreeStats } from './types';

/**
 * Root parallelization for the MCTS mode: N independent trees (each with a
 * rotated seed offset) run on separate workers and merge here by POOLED
 * root-cell statistics, ranked by the same equilibrium solve the matrix
 * mode runs (visit counts allocate search effort; they are not the
 * verdict). Pure — rank.ts only, no sim imports, main-thread safe.
 */

/**
 * Fixed tree count. Machine-independent on purpose: results must not vary
 * with a machine's worker-pool size. Pools smaller than this simply run
 * trees in successive rounds.
 */
export const MCTS_TREES = 4;

/** Merges parallel trees into one result. Order of `trees` must be fixed. */
export function mergeMctsTrees(trees: MctsTreeStats[]): EvalResult {
  const base = trees[0];
  if (trees.length === 1) return base.result;

  // Pool per-cell reward totals across trees; ONE static prior per cell
  // (the per-tree results already carry it, the pool re-applies it once).
  const pooled = new Map<number, { visits: number; total: number; value: number; ended: boolean }>();
  for (const tree of trees) {
    for (const cell of tree.cells) {
      const entry = pooled.get(cell.key);
      if (entry) {
        entry.visits += cell.visits;
        entry.total += cell.total;
      } else {
        pooled.set(cell.key, { visits: cell.visits, total: cell.total, value: cell.value, ended: cell.ended });
      }
    }
  }
  const values = base.p1Options.map((_, i) => base.p2Options.map((_, j) => {
    const entry = pooled.get(cellKey(i, j));
    if (!entry) return base.rootValue;
    return (entry.total + entry.value) / (entry.visits + 1);
  }));
  const ended = base.p1Options.map((_, i) =>
    base.p2Options.map((_, j) => pooled.get(cellKey(i, j))?.ended ?? false));

  const ranked = rankFromMatrix(
    { p1Options: base.p1Options, p2Options: base.p2Options, values, ended },
    base.rootValue,
  );
  const result = rankedToResult(ranked, Math.max(...trees.map(tree => tree.depth)));

  // HYBRID SEMANTICS (see mcts.ts toResult): the score keeps the summed
  // visit-mean formulation — bit-comparable with the standing records —
  // while the rankings above carry the pooled equilibrium.
  const sum = (key: 'p1N' | 'p1W' | 'p2N' | 'p2W'): number[] =>
    base[key].map((_, index) => trees.reduce((total, tree) => total + (tree[key][index] ?? 0), 0));
  const topVisited = (n: number[]): number => {
    let best = -1;
    let bestN = 0;
    for (let index = 0; index < n.length; index++) {
      if (n[index] > bestN) {
        bestN = n[index];
        best = index;
      }
    }
    return best;
  };
  const p1N = sum('p1N');
  const p1W = sum('p1W');
  const p2N = sum('p2N');
  const p2W = sum('p2W');
  const i = topVisited(p1N);
  const j = topVisited(p2N);
  const v1 = i >= 0 ? p1W[i] / p1N[i] : base.rootValue;
  const v2 = j >= 0 ? p2W[j] / p2N[j] : base.rootValue;
  result.score = (v1 + v2) / 2;
  result.interval = Math.abs(v2 - v1);

  // The follow-up line comes from a tree that agrees on the top choice.
  if (result.perSide.p1.length > 0) {
    const donor = trees.find(tree =>
      tree.result.perSide.p1[0]?.choice === result.perSide.p1[0].choice && tree.result.perSide.p1[0].line);
    if (donor) result.perSide.p1[0].line = donor.result.perSide.p1[0].line;
  }
  return result;
}
