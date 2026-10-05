import { cellKey } from './rank.ts';
import { matchPlayedSide } from './turn-analysis/played-match.ts';
import type { EvalCellJob, EvalResult, EvalSettings, MctsTreeStats, RankedChoice } from './types.ts';

/**
 * Which root cells the verify step re-prices (moved out of mcts-merge.ts in
 * round 63). A root cell fixes ONE chance outcome per tree at creation —
 * every later visit descends through that same child, so visit counts
 * measure subtree exploration, not independent samples of the cell's own
 * transition (at most one per tree, ever). A support cell is
 * chance-suspect when the pool has too few visits, when too few trees
 * expanded it, or when the trees that did DISAGREE (draft t56: [Ice Beam ×
 * Draco Meteor] per-tree means −0.38/+0.37/−0.34/−0.37 — one tree rode a
 * missed 90% Draco Meteor through its whole subtree; disagreement is
 * visit-weighted since round 33, so a thin outlier beside three deep trees
 * does not count). Suspect cells get re-priced by the matrix mode's
 * multi-seed cell sampler before the verdict stands. Round 63 (T78): the
 * played row and column join the support, and a doubles tree's boundary
 * cells come from the pair plan in the verify step itself. Pure and
 * sim-free, like the merge.
 */

export const VERIFY_MIN_VISITS = 8;
/** Minimum independent chance samples (trees that expanded the cell). */
export const VERIFY_MIN_TREES = 3;
/**
 * Per-tree disagreement beyond which a cell's transition is chance-suspect:
 * the visit-weighted mean absolute deviation of the per-tree means from
 * the pool mean (round 33). Two equal camps 0.15 apart read 0.075, the
 * old max-min threshold's shape; a thin outlier (573756 t137: 54 visits
 * at 25 % beside 600 at 8 %) no longer tips a cell.
 */
export const VERIFY_DISAGREEMENT = 0.075;

export function weightedDisagreement(entries: { mean: number; weight: number }[]): number {
  const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (weight <= 0) return 0;
  const mean = entries.reduce((sum, entry) => sum + entry.mean * entry.weight, 0) / weight;
  return entries.reduce((sum, entry) => sum + Math.abs(entry.mean - mean) * entry.weight, 0) / weight;
}

/** Fixed seeds per verified cell — matrix-zone grade, deterministic. */
export const VERIFY_SAMPLES = 3;
/** Verification budget: at most this many cell jobs per search (decision 9 of round 63: doubles boundary cells included). */
export const VERIFY_CELL_CAP = 12;
/** Pooled visits from which a cell counts as rich for row completion. */
const ROW_RICH_VISITS = 50;
/** Mix weight from which an option counts as equilibrium support. */
const SUPPORT_MIX = 0.05;

/**
 * Round 63 (T78): what the verify step adds to the trees' own view — the
 * played option per side (it joins the support at the nominal mass of the
 * ranked top three) and the cells the pair plan reported as boundary cells.
 */
export interface VerifyFocus {
  played?: { p1?: number; p2?: number };
  boundary?: ReadonlySet<number>;
}

interface PoolStats {
  /** key → prior-blended mean and weight (visits + 1) per expanding tree. */
  perTree: Map<number, { mean: number; weight: number }[]>;
  pooledVisits: Map<number, number>;
  endedCells: Set<number>;
}

function poolStats(trees: MctsTreeStats[]): PoolStats {
  const perTree = new Map<number, { mean: number; weight: number }[]>();
  const pooledVisits = new Map<number, number>();
  const endedCells = new Set<number>();
  for (const tree of trees) {
    for (const cell of tree.cells) {
      pooledVisits.set(cell.key, (pooledVisits.get(cell.key) ?? 0) + cell.visits);
      if (cell.ended) endedCells.add(cell.key);
      const entries = perTree.get(cell.key) ?? [];
      entries.push({ mean: (cell.total + cell.value) / (cell.visits + 1), weight: cell.visits + 1 });
      perTree.set(cell.key, entries);
    }
  }
  return { perTree, pooledVisits, endedCells };
}

/** The chance-suspect predicate over the pool: boundary cells, starved cells, thin trees, disagreeing trees (visit-weighted). */
function suspectFor(trees: MctsTreeStats[], stats: PoolStats, boundary: ReadonlySet<number>): (key: number) => boolean {
  return (key: number): boolean => {
    // A boundary cell's fixed per-tree outcomes cannot represent its
    // accuracy×killFraction split — suspect regardless of visit stats.
    if (boundary.has(key)) return true;
    if ((stats.pooledVisits.get(key) ?? 0) < VERIFY_MIN_VISITS) return true;
    const entries = stats.perTree.get(key) ?? [];
    if (entries.length < Math.min(VERIFY_MIN_TREES, trees.length)) return true;
    return weightedDisagreement(entries) > VERIFY_DISAGREEMENT;
  };
}

/**
 * Support per side: equilibrium mass, with the ranked top three injected
 * at a nominal mass so a starved row the solve DEMOTED on noise still
 * verifies (the demotion may itself be the artifact). Round 63 (T78): the
 * played option joins at the same nominal mass — its row decides the
 * played side's regret.
 */
function supportMass(
  mix: number[],
  ranked: EvalResult['perSide']['p1'],
  byChoice: Map<string, number>,
  played: number | undefined,
): Map<number, number> {
  const mass = new Map<number, number>();
  mix.forEach((weight, index) => {
    if (weight >= SUPPORT_MIX) mass.set(index, weight);
  });
  for (const entry of ranked.slice(0, 3)) {
    const index = byChoice.get(entry.choice);
    if (index !== undefined && !mass.has(index)) mass.set(index, SUPPORT_MIX / 2);
  }
  if (played !== undefined && !mass.has(played)) mass.set(played, SUPPORT_MIX / 2);
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

interface Support {
  p1Mass: Map<number, number>;
  p2Mass: Map<number, number>;
  /** cellKey → priority mass: support rows × support columns, plus the punisher cells. */
  candidates: Map<number, number>;
}

function supportOf(base: MctsTreeStats, merged: EvalResult, mixes: { p1: number[]; p2: number[] }, focus?: VerifyFocus): Support {
  const p1ByChoice = new Map(base.p1Options.map((option, index) => [option.choice, index]));
  const p2ByChoice = new Map(base.p2Options.map((option, index) => [option.choice, index]));
  const p1Mass = supportMass(mixes.p1, merged.perSide.p1, p1ByChoice, focus?.played?.p1);
  const p2Mass = supportMass(mixes.p2, merged.perSide.p2, p2ByChoice, focus?.played?.p2);
  const candidates = new Map<number, number>();
  for (const [i, massI] of p1Mass) {
    for (const [j, massJ] of p2Mass) {
      candidates.set(cellKey(i, j), massI * massJ);
    }
  }
  const p1ByLabel = new Map(base.p1Options.map((option, index) => [option.label, index]));
  const p2ByLabel = new Map(base.p2Options.map((option, index) => [option.label, index]));
  addPunisherCells(candidates, merged.perSide.p1, p1ByChoice, p2ByLabel, (own, opp) => cellKey(own, opp));
  addPunisherCells(candidates, merged.perSide.p2, p2ByChoice, p1ByLabel, (own, opp) => cellKey(opp, own));
  return { p1Mass, p2Mass, candidates };
}

/** A cell job for one cell key of the base tree's option grid. */
function cellJob(base: MctsTreeStats, key: number): EvalCellJob {
  const i = Math.floor(key / 10_000);
  const j = key % 10_000;
  return { i, j, p1Choice: base.p1Options[i].choice, p2Choice: base.p2Options[j].choice, samples: VERIFY_SAMPLES };
}

const boundaryOf = (trees: MctsTreeStats[], focus?: VerifyFocus): Set<number> =>
  new Set([...(trees[0].boundaryCells ?? []), ...(focus?.boundary ?? [])]);

/**
 * The cells the merged equilibrium actually leans on — support rows ×
 * support columns (mix ≥ SUPPORT_MIX, plus each side's ranked top three,
 * the played option and the top three's punisher cells) — that the pool
 * has visited fewer than VERIFY_MIN_VISITS times (unexpanded cells count
 * zero: they read the bare root static, the least-earned value in the
 * matrix). Ordered by support mass, capped at VERIFY_CELL_CAP, emitted as
 * matrix-grade cell jobs.
 */
export function starvedSupportCells(trees: MctsTreeStats[], merged: EvalResult, focus?: VerifyFocus): EvalCellJob[] {
  const mixes = merged.matrix?.mixes;
  if (!mixes) return [];
  const stats = poolStats(trees);
  const boundary = boundaryOf(trees, focus);
  const suspect = suspectFor(trees, stats, boundary);
  return [...supportOf(trees[0], merged, mixes, focus).candidates.entries()]
    // Boundary cells bypass the ended exclusion: a game-ending kill range
    // is ended in its drawn class precisely because the pool cannot see
    // the other one. sampleCell's own ended semantics (ALL children ended)
    // replace the pooled flag through the verified merge.
    .filter(([key]) => suspect(key) && (boundary.has(key) || !stats.endedCells.has(key)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, VERIFY_CELL_CAP)
    .map(([key]) => cellJob(trees[0], key));
}

/**
 * Round 63 (T78): a doubles tree ships no boundary list (mcts.ts; the
 * analytic plan gives up on every combined choice), so the pair plan — the
 * sampler that prices doubles cells — decides it here: the support and
 * played cells the visit stats do not make eligible (rich and agreeing, or
 * ended in the pool) are checked, heaviest first, at most VERIFY_CELL_CAP.
 * Empty where the tree shipped its own list (singles).
 */
export function boundaryCheckCells(trees: MctsTreeStats[], merged: EvalResult, focus?: VerifyFocus): EvalCellJob[] {
  const mixes = merged.matrix?.mixes;
  if (!mixes || trees[0].boundaryCells !== undefined) return [];
  const stats = poolStats(trees);
  const suspect = suspectFor(trees, stats, new Set());
  return [...supportOf(trees[0], merged, mixes, focus).candidates.entries()]
    .filter(([key]) => !suspect(key) || stats.endedCells.has(key))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, VERIFY_CELL_CAP)
    .map(([key]) => cellJob(trees[0], key));
}

/**
 * Row completion (round 33): a verify row or column that holds a rich cell
 * (ROW_RICH_VISITS pooled visits) and a starved one compares depths. Every
 * other support cell of that row and column joins the jobs, behind the
 * starved ones and under the same cap, so the whole line is priced by the
 * same estimator (655336 t24: one deep Dragon Claw cell beside a one-ply
 * Dragon Dance sibling read as a blunder). Rich cells keep their depth,
 * ended cells stay out.
 */
export function rowCompletedCells(trees: MctsTreeStats[], merged: EvalResult, jobs: EvalCellJob[], focus?: VerifyFocus): EvalCellJob[] {
  const base = trees[0];
  const mixes = merged.matrix?.mixes;
  if (!mixes || jobs.length === 0) return jobs;
  const stats = poolStats(trees);
  const rich = (i: number, j: number) => (stats.pooledVisits.get(cellKey(i, j)) ?? 0) >= ROW_RICH_VISITS;
  const { p1Mass, p2Mass } = supportOf(base, merged, mixes, focus);
  const taken = new Set(jobs.map(job => cellKey(job.i, job.j)));
  const extra = new Map<number, number>();
  const consider = (i: number, j: number, mass: number) => {
    const key = cellKey(i, j);
    if (taken.has(key) || rich(i, j) || stats.endedCells.has(key)) return;
    extra.set(key, Math.max(extra.get(key) ?? 0, mass));
  };
  for (const job of jobs) {
    const rowRich = [...p2Mass.keys()].some(j => rich(job.i, j));
    const columnRich = [...p1Mass.keys()].some(i => rich(i, job.j));
    if (rowRich) for (const [j, massJ] of p2Mass) consider(job.i, j, (p1Mass.get(job.i) ?? SUPPORT_MIX / 2) * massJ);
    if (columnRich) for (const [i, massI] of p1Mass) consider(i, job.j, massI * (p2Mass.get(job.j) ?? SUPPORT_MIX / 2));
  }
  const completions = [...extra.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([key]) => cellJob(base, key));
  return [...jobs, ...completions].slice(0, VERIFY_CELL_CAP);
}

/**
 * Round 63 (T78): the played option per side from keepPlayed, as an index
 * into the base tree's lists — doubles slots through the combined option
 * (the charitable consistent one where a slot stayed hidden), singles the
 * played action. Sides without a match are left out.
 */
export function playedIndices(
  trees: MctsTreeStats[], merged: EvalResult, keepPlayed: EvalSettings['keepPlayed'],
): { p1?: number; p2?: number } {
  if (!keepPlayed) return {};
  const played = { p1: keepPlayed.p1 ?? null, p2: keepPlayed.p2 ?? null, p1Slots: keepPlayed.p1Slots, p2Slots: keepPlayed.p2Slots };
  const out: { p1?: number; p2?: number } = {};
  for (const side of ['p1', 'p2'] as const) {
    const match = matchPlayedSide(merged, side, played);
    const options = side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
    const index = match ? options.findIndex(option => option.choice === match.choice) : -1;
    if (index >= 0) out[side] = index;
  }
  return out;
}
