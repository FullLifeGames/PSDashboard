import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePosition, advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import {
  BOUNDARY_DRAW_BUDGET, classifyChild, foldClassWeights, observeOrder, planCellEvents, PROBE_SEEDS, type CellEvent,
} from '../cell-blend.ts';
import type { CellBlend, CellBlendClass, CellDraw, KoOddsMismatch } from '../types.ts';
import type { RollScripts } from '../forward/scripted-prng.ts';
import { countFainted, leafValue, rollSensitivePair, SEARCH_SEEDS, speedTie, tieOrderScripts } from './leaf.ts';
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
  /**
   * Round 70: the base draws behind `value`, the draws the horizon-trend probe replays: the leading search seeds
   * the cell was drawn with (a speed-tied cell: both move orders). Absent for a cell of one draw of the first seed,
   * whose child the probe takes for the cell.
   */
  baseDraws?: CellDraw[];
}

/** The leading search seeds a cell drew, as the cell reports them; nothing for the one draw every cell has. */
const leadingDraws = (count: number): { baseDraws?: CellDraw[] } =>
  (count > 1 ? { baseDraws: Array.from({ length: count }, (_, index) => ({ index })) } : {});

/** The base draws of a boundary cell: `samples` leading seeds, at least the first. */
const blendBaseDraws = (samples: number): number => Math.max(1, Math.min(samples, SEARCH_SEEDS.length));

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

/**
 * Round 69 (T146 c2): the analytic weight of unreached classes from which on a blend cell prices as the mean of
 * its draws. The unreached weight of the bank's singles cells sits at or below 0.197 for a class a few draws miss by
 * chance (a crit class of 0.06 to 0.19 stays out of 16 draws up to 18 % of the time at 0.1, 3 % at 0.2) and from
 * 0.207 up for model gaps (missing-census, singles r61 positions); 0.2 is the gap, and a real class of that weight
 * is out of 16 draws only 3 % of the time.
 */
export const MISSING_WEIGHT_CUT = 0.2;

/** One seeded child; with `scripts` the dice of the named moves answer as the script says (a tied cell's move order). */
function advanceChild(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, scripts?: RollScripts): SimPosition {
  return scripts ? advancePositionWithLog(root, p1Choice, p2Choice, seed, { scripts }).child : advancePosition(root, p1Choice, p2Choice, seed);
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
  scripts?: RollScripts,
): CellSample {
  const firstChild = first?.child ?? advanceChild(root, p1Choice, p2Choice, SEARCH_SEEDS[0], scripts);
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
    const child = advanceChild(root, p1Choice, p2Choice, SEARCH_SEEDS[s], scripts);
    sum += leafValue(positionBattle(child), matchupCache);
  }
  return { value: sum / draws, ended, firstChild, ...leadingDraws(draws) };
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

/** The mean over every draw of the cell (the plan's base draws and the chase to the budget). */
function allDrawsSample(draws: Draw[]): CellSample {
  const value = draws.reduce((sum, draw) => sum + draw.leaf, 0) / draws.length;
  return { value, ended: draws[0].ended, firstChild: draws[0].child };
}

/** One seeded draw with its protocol log and leaf value. */
function drawCell(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, matchupCache: MatchupCache, scripts?: RollScripts): Draw {
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed, scripts ? { scripts } : undefined);
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

/** The diagnostic for analytically expected classes no draw reached, or undefined when none is missing. */
function unreachedDiagnostic(
  expected: Map<string, number>, classes: Map<string, ClassEntry>, missing: string[], p1Choice: string, p2Choice: string,
): KoOddsMismatch | undefined {
  if (missing.length === 0) return undefined;
  return {
    i: -1, j: -1, p1Choice, p2Choice, missing, // i/j stamped by the caller
    analytic: Object.fromEntries(expected),
    sampled: Object.fromEntries([...classes].map(([key, cls]) => [key, cls.count])),
  };
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
  const diagnostic = unreachedDiagnostic(expected, classes, missing, p1Choice, p2Choice);
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
  scripts?: RollScripts,
): CellSample {
  const draws: Draw[] = [];
  const drawnBySeed = new Map<string, Draw>();
  const drawSeed = (seed: PRNGSeed) => {
    draws.push(drawCell(root, p1Choice, p2Choice, seed, matchupCache, scripts));
    drawnBySeed.set(String(seed), draws[draws.length - 1]);
  };
  const baseDraws = blendBaseDraws(samples);
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
  // Round 69 (T146 c2): a large unreached weight is a state effect the board before the turn cannot see (a Weakness
  // Policy that turns the survive-survive class into a kill): the renormalised classes would price the cell as if
  // the effect did not exist, so the draws price it, and the diagnostic keeps the model's miss on record.
  if (missing.reduce((sum, key) => sum + expected.get(key)!, 0) >= MISSING_WEIGHT_CUT) {
    const diagnostic = unreachedDiagnostic(expected, classes, missing, p1Choice, p2Choice);
    return plainDraws ? { ...fallback(), diagnostic } : { ...allDrawsSample(draws), diagnostic };
  }
  const pools = plainDraws ? classPools(root, events, p1Choice, p2Choice, plainDraws, matchupCache, classes, drawnBySeed) : undefined;
  return blendFromClasses(expected, classes, weightTotal, missing, draws, p1Choice, p2Choice, pools);
}

/**
 * Round 69 (T146 c4): the two move orders of a tied cell, each priced with its own order scripted, as one cell at
 * one half each. Class keys carry the order prefix (`p1:hit-kill`), as the pair plan's tie cells and the tree's
 * chance nodes write them; a cell whose order priced without a blend keeps the mean alone.
 */
function mixOrders(first: CellSample, second: CellSample): CellSample {
  const mixed: CellSample = { value: (first.value + second.value) / 2, ended: first.ended && second.ended, firstChild: first.firstChild };
  const diagnostic = first.diagnostic ?? second.diagnostic;
  if (diagnostic) mixed.diagnostic = diagnostic;
  // Round 70: the trend probe replays both orders, each with the draws its own price was drawn with.
  const ordered = (order: 'p1' | 'p2', sample: CellSample): CellDraw[] => (sample.baseDraws ?? [{ index: 0 }]).map(draw => ({ ...draw, first: order }));
  mixed.baseDraws = [...ordered('p1', first), ...ordered('p2', second)];
  if (!first.blend || !second.blend) return mixed;
  const prefixed = (order: string, blend: CellBlend, hasFirst: boolean): CellBlendClass[] =>
    blend.classes.map(cls => ({ ...cls, key: `${order}:${cls.key}`, weight: cls.weight / 2, hasFirst: hasFirst && cls.hasFirst }));
  mixed.blend = { classes: [...prefixed('p1', first.blend, true), ...prefixed('p2', second.blend, false)], firstLeaf: first.blend.firstLeaf };
  const children = (order: string, sample: CellSample) => [...(sample.classChildren ?? [])].map(([key, child]) => [`${order}:${key}`, child] as const);
  mixed.classChildren = new Map([...children('p1', first), ...children('p2', second)]);
  return mixed;
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
  // Round 69 (T146 c6): so is a tied cell, whose order the verify pass draws naturally and cannot script.
  const tied = blendRoot && speedTie(rootBattle, p1Choice, p2Choice);
  if (plainDraws && (plan?.kind === 'fail' || tied)) return plainVerifySample(root, p1Choice, p2Choice, plainDraws, matchupCache);
  const price = (scripts?: RollScripts): CellSample => {
    if (plan?.kind !== 'events') return plainCellSample(root, rootBattle, rootFainted, p1Choice, p2Choice, samples, matchupCache, undefined, plainDraws, scripts);
    const blended = blendCellSample(root, plan.events, p1Choice, p2Choice, samples, matchupCache, plainDraws, scripts);
    // Round 70: a root cell reports the base draws behind it (a verify cell has its own pool of natural draws).
    return plainDraws ? blended : { ...blended, ...leadingDraws(blendBaseDraws(samples)) };
  };
  // Round 69 (T146 c4): a tied singles cell is priced once per move order and mixed at one half.
  if (tied && !plainDraws) {
    const orders = tieOrderScripts(p1Choice, p2Choice);
    return mixOrders(price(orders.p1), price(orders.p2));
  }
  return price();
}
