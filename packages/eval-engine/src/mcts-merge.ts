import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank.ts';
import { attachKoOdds, koOddsMapsFor } from './search/root-payload.ts';
import type { EvalCellJob, EvalCellValue, EvalResult, KoOddsMismatch, MctsTreeStats, RankedChoice } from './types.ts';

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
 * A root cell fixes ONE chance outcome per tree at creation — every later
 * visit descends through that same child, so visit counts measure subtree
 * exploration, not independent samples of the cell's own transition (at
 * most one per tree, ever). A support cell is chance-suspect when the pool
 * has too few visits, when too few trees expanded it, or when the trees
 * that did DISAGREE (draft t56: [Ice Beam × Draco Meteor] per-tree means
 * −0.38/+0.37/−0.34/−0.37 — one tree rode a missed 90% Draco Meteor
 * through its whole subtree). Suspect cells get re-priced by the matrix
 * mode's multi-seed cell sampler before the verdict stands.
 */
const VERIFY_MIN_VISITS = 8;
/** Minimum independent chance samples (trees that expanded the cell). */
const VERIFY_MIN_TREES = 3;
/** Per-tree mean spread beyond which a cell's transition is chance-suspect. */
const VERIFY_SPREAD = 0.15;
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
/** Fixed seeds per verified cell — matrix-zone grade, deterministic. */
export const VERIFY_SAMPLES = 3;
/** Verification budget: at most this many cell jobs per search. */
const VERIFY_CELL_CAP = 12;
/** Mix weight from which an option counts as equilibrium support. */
const SUPPORT_MIX = 0.05;

interface PooledCell {
  visits: number;
  total: number;
  value: number;
  ended: boolean;
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
      } else {
        pooled.set(cell.key, { visits: cell.visits, total: cell.total, value: cell.value, ended: cell.ended });
      }
    }
  }
  return pooled;
}

/**
 * The pool's continuation for one root cell: the trees whose drawn child
 * did not end the game, pooled with each tree's own prior, plus the visit
 * count, the number of such trees, and the spread of their per-tree means.
 */
function poolContinuation(trees: MctsTreeStats[], key: number): { value: number; visits: number; trees: number; spread: number } {
  let total = 0;
  let weight = 0;
  let visits = 0;
  const means: number[] = [];
  for (const tree of trees) {
    const cell = tree.cells.find(entry => entry.key === key);
    if (!cell || cell.ended) continue;
    total += cell.total + cell.value;
    weight += cell.visits + 1;
    visits += cell.visits;
    means.push((cell.total + cell.value) / (cell.visits + 1));
  }
  const spread = means.length > 0 ? Math.max(...means) - Math.min(...means) : 0;
  return { value: weight > 0 ? total / weight : NaN, visits, trees: means.length, spread };
}

/**
 * The value a verified cell contributes (round 32). The sampler's job is
 * the ROOT chance split; the trees' job is depth, and depth counts only
 * where the pool has played the cell out. Starved or thin pools and
 * disagreeing trees take the sampler's value as before (round 7; draft
 * t56's draws cannot be assigned to classes here). A rich, agreeing pool
 * whose continuation sits at or beyond VERIFY_DEPTH_FLOOR keeps that
 * depth: without a blend the pooled value stands, with a blend whose
 * classes leave exactly ONE open the ended classes contribute their exact
 * leaves and the open class the pool's continuation (573756 t138: a
 * played-out −0.96 must not become the one-ply static +0.03). The pool's
 * open draws can be assigned to a class only in that one-open-class shape:
 * with two open classes (hit / miss) every tree may have drawn the same
 * one, so those cells keep the sampler's blend too. Everything below the
 * floor is round 7 unchanged.
 */
function verifiedValue(trees: MctsTreeStats[], key: number, cell: EvalCellValue, pooledValue: number): number {
  const pool = poolContinuation(trees, key);
  const rich = pool.visits >= VERIFY_MIN_VISITS && pool.trees >= Math.min(VERIFY_MIN_TREES, trees.length);
  if (!rich || pool.spread > VERIFY_SPREAD || Math.abs(pool.value) < VERIFY_DEPTH_FLOOR) return cell.value;
  if (!cell.blend) return pooledValue;
  if (cell.blend.classes.filter(cls => !cls.ended).length !== 1) return cell.value;
  let value = 0;
  for (const cls of cell.blend.classes) value += cls.weight * (cls.ended ? cls.leafSum / cls.count : pool.value);
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
    return (entry.total + entry.value) / (entry.visits + 1);
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

interface PoolStats {
  /** key → prior-blended mean per expanding tree. */
  perTree: Map<number, number[]>;
  pooledVisits: Map<number, number>;
  endedCells: Set<number>;
}

function poolStats(trees: MctsTreeStats[]): PoolStats {
  const perTree = new Map<number, number[]>();
  const pooledVisits = new Map<number, number>();
  const endedCells = new Set<number>();
  for (const tree of trees) {
    for (const cell of tree.cells) {
      pooledVisits.set(cell.key, (pooledVisits.get(cell.key) ?? 0) + cell.visits);
      if (cell.ended) endedCells.add(cell.key);
      const means = perTree.get(cell.key) ?? [];
      means.push((cell.total + cell.value) / (cell.visits + 1));
      perTree.set(cell.key, means);
    }
  }
  return { perTree, pooledVisits, endedCells };
}

/** The chance-suspect predicate over the pool: boundary cells, starved cells, thin trees, disagreeing trees. */
function suspectFor(trees: MctsTreeStats[], stats: PoolStats, boundary: Set<number>): (key: number) => boolean {
  return (key: number): boolean => {
    // A boundary cell's fixed per-tree outcomes cannot represent its
    // accuracy×killFraction split — suspect regardless of visit stats.
    if (boundary.has(key)) return true;
    if ((stats.pooledVisits.get(key) ?? 0) < VERIFY_MIN_VISITS) return true;
    const means = stats.perTree.get(key) ?? [];
    if (means.length < Math.min(VERIFY_MIN_TREES, trees.length)) return true;
    return Math.max(...means) - Math.min(...means) > VERIFY_SPREAD;
  };
}

/**
 * Support per side: equilibrium mass, with the ranked top three injected
 * at a nominal mass so a starved row the solve DEMOTED on noise still
 * verifies (the demotion may itself be the artifact).
 */
function supportMass(
  mix: number[],
  ranked: EvalResult['perSide']['p1'],
  byChoice: Map<string, number>,
): Map<number, number> {
  const mass = new Map<number, number>();
  mix.forEach((weight, index) => {
    if (weight >= SUPPORT_MIX) mass.set(index, weight);
  });
  for (const entry of ranked.slice(0, 3)) {
    const index = byChoice.get(entry.choice);
    if (index !== undefined && !mass.has(index)) mass.set(index, SUPPORT_MIX / 2);
  }
  return mass;
}

/**
 * Punisher cells: each top entry's floor is a single cell — if that cell
 * is starved, the floor (and punishedBy) is a coin flip too. `key` maps
 * (own index, opponent index) onto the cell key for the entry's side.
 */
function addPunisherCells(
  candidates: Map<number, number>,
  entries: RankedChoice[],
  ownByChoice: Map<string, number>,
  oppByLabel: Map<string, number>,
  key: (own: number, opp: number) => number,
): void {
  for (const entry of entries.slice(0, 3)) {
    const own = ownByChoice.get(entry.choice);
    const opp = entry.punishedBy !== null ? oppByLabel.get(entry.punishedBy) : undefined;
    if (own !== undefined && opp !== undefined) {
      const cell = key(own, opp);
      candidates.set(cell, Math.max(candidates.get(cell) ?? 0, SUPPORT_MIX * SUPPORT_MIX));
    }
  }
}

/**
 * The cells the merged equilibrium actually leans on — support rows ×
 * support columns (mix ≥ SUPPORT_MIX, plus each side's ranked top three and
 * their punisher cells) — that the pool has visited fewer than
 * VERIFY_MIN_VISITS times (unexpanded cells count zero: they read the bare
 * root static, the least-earned value in the matrix). Ordered by support
 * mass, capped at VERIFY_CELL_CAP, emitted as matrix-grade cell jobs.
 */
export function starvedSupportCells(trees: MctsTreeStats[], merged: EvalResult): EvalCellJob[] {
  const base = trees[0];
  const mixes = merged.matrix?.mixes;
  if (!mixes) return [];
  const stats = poolStats(trees);
  const boundary = new Set(trees[0].boundaryCells ?? []);
  const suspect = suspectFor(trees, stats, boundary);

  const p1ByChoice = new Map(base.p1Options.map((option, index) => [option.choice, index]));
  const p2ByChoice = new Map(base.p2Options.map((option, index) => [option.choice, index]));
  const p1Mass = supportMass(mixes.p1, merged.perSide.p1, p1ByChoice);
  const p2Mass = supportMass(mixes.p2, merged.perSide.p2, p2ByChoice);

  const candidates = new Map<number, number>(); // cellKey → priority mass
  for (const [i, massI] of p1Mass) {
    for (const [j, massJ] of p2Mass) {
      candidates.set(cellKey(i, j), massI * massJ);
    }
  }
  const p1ByLabel = new Map(base.p1Options.map((option, index) => [option.label, index]));
  const p2ByLabel = new Map(base.p2Options.map((option, index) => [option.label, index]));
  addPunisherCells(candidates, merged.perSide.p1, p1ByChoice, p2ByLabel, (own, opp) => cellKey(own, opp));
  addPunisherCells(candidates, merged.perSide.p2, p2ByChoice, p1ByLabel, (own, opp) => cellKey(opp, own));

  return [...candidates.entries()]
    // Boundary cells bypass the ended exclusion: a game-ending kill range
    // is ended in its drawn class precisely because the pool cannot see
    // the other one. sampleCell's own ended semantics (ALL children ended)
    // replace the pooled flag through the verified merge.
    .filter(([key]) => suspect(key) && (boundary.has(key) || !stats.endedCells.has(key)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, VERIFY_CELL_CAP)
    .map(([key]) => {
      const i = Math.floor(key / 10_000);
      const j = key % 10_000;
      return {
        i, j,
        p1Choice: base.p1Options[i].choice,
        p2Choice: base.p2Options[j].choice,
        samples: VERIFY_SAMPLES,
      };
    });
}
