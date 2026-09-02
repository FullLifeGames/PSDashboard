import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function';
import { advancePosition, advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model';
import {
  BOUNDARY_DRAW_BUDGET, classifyChild, foldClassWeights, observeOrder, planCellEvents, PROBE_SEEDS, type CellEvent,
} from '../cell-blend';
import type { CellBlend, CellBlendClass, KoOddsMismatch } from '../types';
import { countFainted, leafValue, rollSensitivePair, SEARCH_SEEDS } from './leaf';

/**
 * One matrix cell's value from seeded sims: the plain seed average, or the
 * analytic class blend on root boundary cells.
 */

/** One sampled root cell: its value, whether it ended, the first-seed child, and the blend when one applied. */
export interface CellSample {
  value: number;
  ended: boolean;
  firstChild: SimPosition;
  blend?: CellBlend;
  diagnostic?: KoOddsMismatch;
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
): CellSample {
  const firstChild = advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[0]);
  const firstBattle = positionBattle(firstChild);
  const ended = firstBattle.ended;
  // Averaging wp-units = averaging win probabilities across rolls: the
  // KO-boundary roll groups carry their true value ("30% this crit wins")
  // instead of a flattened score mean.
  let sum = leafValue(firstBattle, matchupCache);
  const rollMoves = rollSensitivePair(rootBattle, p1Choice, p2Choice);
  const draws = ended
    ? (rollMoves ? Math.max(samples, 3) : 1)
    : (countFainted(firstBattle) > rootFainted || rollMoves ? samples : 1);
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
  const entry = classes.get(key) ?? { leafSum: 0, count: 0, hasFirst: false, ended: true };
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
): CellSample {
  let value = 0;
  const blendClasses: CellBlendClass[] = [];
  for (const [key, weight] of expected) {
    const cls = classes.get(key);
    if (!cls) continue;
    const normalized = weight / weightTotal; // 1.0 total when nothing is missing
    value += normalized * (cls.leafSum / cls.count);
    blendClasses.push({ weight: normalized, leafSum: cls.leafSum, count: cls.count, hasFirst: cls.hasFirst });
  }
  const blend: CellBlend = { classes: blendClasses, firstLeaf: draws[0].leaf };
  const ended = draws.every(draw => draw.ended);
  const diagnostic: KoOddsMismatch | undefined = missing.length > 0
    ? {
      i: -1, j: -1, p1Choice, p2Choice, missing, // i/j stamped by the caller
      analytic: Object.fromEntries(expected),
      sampled: Object.fromEntries([...classes].map(([key, cls]) => [key, cls.count])),
    }
    : undefined;
  return { value, ended, firstChild: draws[0].child, blend, ...(diagnostic ? { diagnostic } : {}) };
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
): CellSample {
  const draws: Draw[] = [];
  const drawSeed = (seed: PRNGSeed) => { draws.push(drawCell(root, p1Choice, p2Choice, seed, matchupCache)); };
  const baseDraws = Math.max(1, Math.min(samples, SEARCH_SEEDS.length));
  for (let s = 0; s < baseDraws; s++) drawSeed(SEARCH_SEEDS[s]);

  const fallback = () => ({
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
  return blendFromClasses(expected, classes, weightTotal, missing, draws, p1Choice, p2Choice);
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
 * makes.
 */
export function sampleCell(
  root: SimPosition,
  rootFainted: number,
  p1Choice: string,
  p2Choice: string,
  samples: number,
  matchupCache: MatchupCache,
  blendRoot = false,
): CellSample {
  const rootBattle = positionBattle(root);
  const plan = blendRoot ? planCellEvents(rootBattle, p1Choice, p2Choice) : null;
  if (!plan || plan.kind !== 'events') {
    return plainCellSample(root, rootBattle, rootFainted, p1Choice, p2Choice, samples, matchupCache);
  }
  return blendCellSample(root, plan.events, p1Choice, p2Choice, samples, matchupCache);
}
