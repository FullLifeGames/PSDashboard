import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePosition, advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import {
  BOUNDARY_DRAW_BUDGET, classifyChild, foldClassWeights, observeOrder, planCellEvents, PROBE_SEEDS, type CellEvent,
} from '../cell-blend.ts';
import type { CellBlend, CellBlendClass, KoOddsMismatch } from '../types.ts';
import { countFainted, leafValue, rollSensitivePair, SEARCH_SEEDS } from './leaf.ts';
import { pairCellSample, type FirstDraw } from '../pair/sampler.ts';
import {
  drawPlain, firstDraw, outcomeGroups, stateGroups, stateRuleFor, VERIFY_PLAIN_SEEDS, type PlainDraw, type StateGroup, type VerifyDraws,
} from './verify-cell.ts';

/**
 * One matrix cell's value from seeded sims: the plain seed average, or the
 * analytic class blend on root boundary cells.
 */

/**
 * One sampled root cell: its value, whether it ended, the first-seed child,
 * and the blend when one applied. Round 63 (T16): the class children and a
 * verify cell's outcome groups ride along for the verify step's deepening.
 */
export interface CellSample extends VerifyDraws {
  value: number;
  ended: boolean;
  firstChild: SimPosition;
  blend?: CellBlend;
  diagnostic?: KoOddsMismatch;
}

/**
 * Round 63 (T16): a verify cell without a plan prices `plainDraws` natural
 * draws (the first one reused when given) and hands their outcome groups on
 * (round 64: with the states their draws leave).
 */
export function plainVerifySample(
  root: SimPosition, p1Choice: string, p2Choice: string, plainDraws: number, matchupCache: MatchupCache, first?: PlainDraw,
): CellSample {
  const draws = VERIFY_PLAIN_SEEDS.slice(0, plainDraws).map((seed, index) =>
    (index === 0 && first ? first : drawPlain(root, p1Choice, p2Choice, seed, matchupCache)));
  const value = draws.reduce((sum, draw) => sum + draw.leaf, 0) / draws.length;
  return { value, ended: draws[0].ended, firstChild: draws[0].child, outcomes: outcomeGroups(draws) };
}

/**
 * Round 64 (T119): the verify pool of a plain cell. A cell the sampler
 * draws once (no accuracy roll, no faint) draws the game type's pool too,
 * and keeps its one draw unless the pool shows a second outcome or a
 * second state (a sure-hit Spore's sleep counter, Scald's burn); null then.
 */
function verifyPool(
  root: SimPosition, p1Choice: string, p2Choice: string, plainDraws: number, matchupCache: MatchupCache, first: PlainDraw, drawsMore: boolean,
): CellSample | null {
  const size = drawsMore ? plainDraws : Math.min(plainDraws, stateRuleFor(root).pool);
  const pool = plainVerifySample(root, p1Choice, p2Choice, size, matchupCache, first);
  return drawsMore || pool.outcomes!.length > 1 || pool.outcomes![0].groups ? pool : null;
}

/** The plain seed average (no analytic blend): one sim unless a KO or a roll makes seeds diverge. */
function plainCellSample(
  root: SimPosition,
  rootBattle: ReturnType<typeof positionBattle>,
  rootFainted: number,
  p1Choice: string,
  p2Choice: string,
  samples: number,
  matchupCache: MatchupCache,
  first?: FirstDraw,
  plainDraws?: number,
): CellSample {
  const firstChild = first?.child ?? advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[0]);
  const firstBattle = positionBattle(firstChild);
  const ended = firstBattle.ended;
  // Averaging wp-units = averaging win probabilities across rolls: the
  // KO-boundary roll groups carry their true value ("30% this crit wins")
  // instead of a flattened score mean.
  let sum = first?.leaf ?? leafValue(firstBattle, matchupCache);
  const rollMoves = rollSensitivePair(rootBattle, p1Choice, p2Choice);
  const draws = ended
    ? (rollMoves ? Math.max(samples, 3) : 1)
    : (countFainted(firstBattle) > rootFainted || rollMoves ? samples : 1);
  if (plainDraws) {
    const log = first?.log ?? advancePositionWithLog(root, p1Choice, p2Choice, SEARCH_SEEDS[0]).log;
    const pool = verifyPool(root, p1Choice, p2Choice, plainDraws, matchupCache, { child: firstChild, log, leaf: sum, ended }, draws > 1);
    if (pool) return pool;
  }
  for (let s = 1; s < draws; s++) {
    const child = advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[s]);
    sum += leafValue(positionBattle(child), matchupCache);
  }
  return { value: sum / draws, ended, firstChild };
}

interface Draw {
  child: SimPosition;
  log: string[];
  leaf: number;
  ended: boolean;
}

interface ClassEntry {
  leafSum: number;
  count: number;
  hasFirst: boolean;
  ended: boolean;
  /** The class's first draw: the child the verify step deepens. */
  child: SimPosition;
  /** Round 64: every draw of the class, the plan's in order, then the verify pool's. */
  draws: Draw[];
}

/** One seeded draw with its protocol log and leaf value. */
function drawCell(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, matchupCache: MatchupCache): Draw {
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed);
  const battle = positionBattle(child);
  return { child, log, leaf: leafValue(battle, matchupCache), ended: battle.ended };
}

/** Books a draw into its outcome class; false when the draw fits no analytically expected class. */
function classifyDraw(
  classes: Map<string, ClassEntry>,
  expected: Map<string, number>,
  events: CellEvent[],
  draw: Draw,
  isFirst: boolean,
): boolean {
  const key = classifyChild(draw.log, events);
  if (key === null || !expected.has(key)) return false;
  const entry = classes.get(key) ?? { leafSum: 0, count: 0, hasFirst: false, ended: true, child: draw.child, draws: [] };
  entry.draws.push(draw);
  entry.leafSum += draw.leaf;
  entry.count += 1;
  entry.hasFirst = entry.hasFirst || isFirst;
  entry.ended = entry.ended && draw.ended;
  classes.set(key, entry);
  return true;
}

/** The analytically weighted class means, the blend payload, and the diagnostic for unsampled classes. */
function blendFromClasses(
  expected: Map<string, number>,
  classes: Map<string, ClassEntry>,
  weightTotal: number,
  missing: string[],
  draws: Draw[],
  p1Choice: string,
  p2Choice: string,
  pools?: ReadonlyMap<string, Draw[]>,
): CellSample {
  let value = 0;
  const blendClasses: CellBlendClass[] = [];
  for (const [key, weight] of expected) {
    const cls = classes.get(key);
    if (!cls) continue;
    const normalized = weight / weightTotal; // 1.0 total when nothing is missing
    value += normalized * (cls.leafSum / cls.count);
    blendClasses.push({ key, weight: normalized, leafSum: cls.leafSum, count: cls.count, hasFirst: cls.hasFirst, ended: cls.ended });
  }
  const blend: CellBlend = { classes: blendClasses, firstLeaf: draws[0].leaf };
  const classChildren = new Map([...classes].map(([key, cls]) => [key, cls.child]));
  const classGroups = new Map<string, StateGroup[]>();
  for (const [key, cls] of pools ?? []) {
    const groups = stateGroups(cls, firstDraw);
    if (groups) classGroups.set(key, groups);
  }
  const ended = draws.every(draw => draw.ended);
  const diagnostic: KoOddsMismatch | undefined = missing.length > 0
    ? {
      i: -1, j: -1, p1Choice, p2Choice, missing, // i/j stamped by the caller
      analytic: Object.fromEntries(expected),
      sampled: Object.fromEntries([...classes].map(([key, cls]) => [key, cls.count])),
    }
    : undefined;
  return {
    value, ended, firstChild: draws[0].child, blend, classChildren,
    ...(classGroups.size > 0 ? { classGroups } : {}), ...(diagnostic ? { diagnostic } : {}),
  };
}

/**
 * Round 64 (T119): every class's draws for the verify step, the plan's own
 * first and then the rest of the `plainDraws` natural seeds read with the
 * plan's reader. A pool draw that reads into no planned class is left out;
 * the pool never changes the plan's classes, weights or one-ply means.
 */
function classPools(
  root: SimPosition, events: CellEvent[], p1Choice: string, p2Choice: string, plainDraws: number,
  matchupCache: MatchupCache, classes: Map<string, ClassEntry>, drawnBySeed: Map<string, Draw>,
): Map<string, Draw[]> {
  const pools = new Map([...classes].map(([key, cls]) => [key, [...cls.draws]]));
  for (const seed of VERIFY_PLAIN_SEEDS.slice(0, plainDraws)) {
    if (drawnBySeed.has(String(seed))) continue;
    const draw = drawCell(root, p1Choice, p2Choice, seed, matchupCache);
    const key = classifyChild(draw.log, events);
    if (key !== null) pools.get(key)?.push(draw);
  }
  return pools;
}

/**
 * Blend path (round 6): draw with logs, classify children into outcome
 * classes, weight the class means analytically — a 43% kill roll cannot
 * sample 5/5 and grade certain anymore. Any deviation from the fold's
 * occurrence model falls back to the plain seed average.
 */
function blendCellSample(
  root: SimPosition,
  events: CellEvent[],
  p1Choice: string,
  p2Choice: string,
  samples: number,
  matchupCache: MatchupCache,
  plainDraws?: number,
): CellSample {
  const draws: Draw[] = [];
  const drawnBySeed = new Map<string, Draw>();
  const drawSeed = (seed: PRNGSeed) => {
    draws.push(drawCell(root, p1Choice, p2Choice, seed, matchupCache));
    drawnBySeed.set(String(seed), draws[draws.length - 1]);
  };
  const baseDraws = Math.max(1, Math.min(samples, SEARCH_SEEDS.length));
  for (let s = 0; s < baseDraws; s++) drawSeed(SEARCH_SEEDS[s]);

  const fallback = (): CellSample => (plainDraws
    ? plainVerifySample(root, p1Choice, p2Choice, plainDraws, matchupCache, draws[0])
    : {
      value: draws.slice(0, baseDraws).reduce((sum, draw) => sum + draw.leaf, 0) / baseDraws,
      ended: draws[0].ended,
      firstChild: draws[0].child,
    });

  const first = observeOrder(draws.map(draw => draw.log), events);
  if (first === null) return fallback();
  const expected = foldClassWeights(events, first);
  const classes = new Map<string, ClassEntry>();
  for (let index = 0; index < draws.length; index++) {
    if (!classifyDraw(classes, expected, events, draws[index], index === 0)) return fallback();
  }
  // Chase analytically-expected classes the base draws missed.
  let probeIndex = 0;
  while (
    [...expected.keys()].some(key => !classes.has(key)) &&
    draws.length < BOUNDARY_DRAW_BUDGET && probeIndex < PROBE_SEEDS.length
  ) {
    drawSeed(PROBE_SEEDS[probeIndex++]);
    if (!classifyDraw(classes, expected, events, draws[draws.length - 1], false)) return fallback();
  }

  const missing = [...expected.keys()].filter(key => !classes.has(key));
  let weightTotal = 0;
  for (const [key, weight] of expected) if (classes.has(key)) weightTotal += weight;
  if (weightTotal <= 0) return fallback();
  const pools = plainDraws ? classPools(root, events, p1Choice, p2Choice, plainDraws, matchupCache, classes, drawnBySeed) : undefined;
  return blendFromClasses(expected, classes, weightTotal, missing, draws, p1Choice, p2Choice, pools);
}

/**
 * Damage-roll grouping (foul-play style): a cell where nothing fainted is
 * roll-insensitive — one sim suffices. Cells where a KO happened get the
 * full seed spread, and so do cells whose pair carries an accuracy roll or
 * a random-call move (Sleep Talk) — the seed decides those outcomes.
 * A child that ENDED the game is exact only when no such roll was involved:
 * draft T64 priced a 90%-accurate Overheat as a CERTAIN +1.00 off one seed
 * that hit, so terminal roll cells always take at least three seeds, even
 * in single-sample sweeps — a ±1 claim is the strongest output the engine
 * makes. Round 56: doubles root cells are priced by the pair plan
 * (pair/sampler.ts); singles cells are untouched.
 */
export function sampleCell(
  root: SimPosition,
  rootFainted: number,
  p1Choice: string,
  p2Choice: string,
  samples: number,
  matchupCache: MatchupCache,
  blendRoot = false,
  plainDraws?: number,
): CellSample {
  const rootBattle = positionBattle(root);
  // Round 56: a doubles root cell takes the pair plan (pair/sampler.ts); a
  // cell without events there continues today's plain path with its draw.
  if (blendRoot && rootBattle.gameType === 'doubles') {
    const pair = pairCellSample(root, p1Choice, p2Choice, samples, matchupCache, plainDraws);
    if (pair.kind === 'sample') return pair.sample;
    if (pair.kind === 'plain') return plainCellSample(root, rootBattle, rootFainted, p1Choice, p2Choice, samples, matchupCache, pair.first, plainDraws);
  }
  const plan = blendRoot ? planCellEvents(rootBattle, p1Choice, p2Choice) : null;
  // Round 63 (T16): a guard the plan cannot fold (a paralyzed attacker, a
  // Substitute, a pivot) is chance of its own: a verify cell draws them all.
  if (plainDraws && plan?.kind === 'fail') return plainVerifySample(root, p1Choice, p2Choice, plainDraws, matchupCache);
  if (!plan || plan.kind !== 'events') {
    return plainCellSample(root, rootBattle, rootFainted, p1Choice, p2Choice, samples, matchupCache, undefined, plainDraws);
  }
  return blendCellSample(root, plan.events, p1Choice, p2Choice, samples, matchupCache, plainDraws);
}
