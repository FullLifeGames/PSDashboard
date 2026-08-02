import type { EvalChoiceOption, EvalResult, MctsTreeStats, RankedChoice } from './types';

/**
 * Root parallelization for the MCTS mode: N independent trees (each with a
 * rotated seed offset) run on separate workers and merge here by summed
 * root visit statistics. Pure — no sim imports, main-thread safe.
 */

/**
 * Fixed tree count. Machine-independent on purpose: results must not vary
 * with a machine's worker-pool size. Pools smaller than this simply run
 * trees in successive rounds.
 */
export const MCTS_TREES = 4;

function rankMerged(
  options: EvalChoiceOption[],
  n: number[],
  w: number[],
  ownSign: 1 | -1,
  trees: MctsTreeStats[],
): RankedChoice[] {
  return options
    .map((option, index) => ({ option, index }))
    .filter(entry => n[entry.index] > 0)
    .sort((a, b) => n[b.index] - n[a.index] || a.index - b.index)
    .map(entry => {
      const mean = ownSign * (w[entry.index] / n[entry.index]);
      // The punishing reply comes from the tree that explored this option
      // hardest — its statistics say the most about the replies.
      let punishedBy: string | null = null;
      let bestVisits = -1;
      for (const tree of trees) {
        const treeN = ownSign === 1 ? tree.p1N : tree.p2N;
        if ((treeN[entry.index] ?? 0) > bestVisits) {
          bestVisits = treeN[entry.index] ?? 0;
          const ranked = ownSign === 1 ? tree.result.perSide.p1 : tree.result.perSide.p2;
          punishedBy = ranked.find(choice => choice.choice === entry.option.choice)?.punishedBy ?? null;
        }
      }
      return {
        choice: entry.option.choice,
        label: entry.option.label,
        worstCase: mean,
        expected: mean,
        punishedBy,
      };
    });
}

/** Merges parallel trees into one result. Order of `trees` must be fixed. */
export function mergeMctsTrees(trees: MctsTreeStats[]): EvalResult {
  const base = trees[0];
  if (trees.length === 1) return base.result;

  const sum = (key: 'p1N' | 'p1W' | 'p2N' | 'p2W'): number[] =>
    base[key].map((_, index) => trees.reduce((total, tree) => total + (tree[key][index] ?? 0), 0));
  const p1 = rankMerged(base.p1Options, sum('p1N'), sum('p1W'), 1, trees);
  const p2 = rankMerged(base.p2Options, sum('p2N'), sum('p2W'), -1, trees);

  // The follow-up line comes from a tree that agrees on the top choice.
  if (p1.length > 0) {
    const donor = trees.find(tree =>
      tree.result.perSide.p1[0]?.choice === p1[0].choice && tree.result.perSide.p1[0].line);
    if (donor) p1[0].line = donor.result.perSide.p1[0].line;
  }

  const v1 = p1.length > 0 ? p1[0].worstCase : base.result.score;
  const v2 = p2.length > 0 ? -p2[0].worstCase : base.result.score;
  return {
    score: (v1 + v2) / 2,
    interval: Math.abs(v2 - v1),
    depthCompleted: Math.max(...trees.map(tree => tree.depth)),
    perSide: { p1, p2 },
  };
}
