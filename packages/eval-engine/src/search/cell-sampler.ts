import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePosition, advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import {
  BOUNDARY_DRAW_BUDGET, classifyChild, foldClassWeights, observeOrder, planCellEvents, type CellEvent,
} from '../cell-blend.ts';
import type { CellBlend, CellBlendClass, CellDraw, KoOddsMismatch } from '../types.ts';
import { DiceSink, type RollScripts, type SecondaryRecord } from '../forward/scripted-prng.ts';
import { mergeScripts, scriptsFor } from './outcome-children.ts';
import { hasSecondary, worthForcing } from './secondary-classes.ts';
import { countFainted, leafValue, rollSensitivePair, BASE_DRAWS, speedTie, tieOrderScripts } from './leaf.ts';
import { pairCellSample, type FirstDraw } from '../pair/sampler.ts';
import { cellSeeds } from './root-quantile.ts';
import {
  drawPlain, firstDraw, outcomeGroups, stateGroups, stateRuleFor, type PlainDraw, type StateGroup, type VerifyDraws,
} from './verify-cell.ts';


/** One sampled root cell: its value, whether it ended, the first-seed child and the blend when one applied. */
export interface CellSample extends VerifyDraws {
  value: number;
  ended: boolean;
  firstChild: SimPosition;
  blend?: CellBlend;
  diagnostic?: KoOddsMismatch;
  /** The leading search seeds the cell was drawn with (a speed-tied cell: both orders); absent for one draw. */
  baseDraws?: CellDraw[];
}

const leadingDraws = (count: number): { baseDraws?: CellDraw[] } =>
  (count > 1 ? { baseDraws: Array.from({ length: count }, (_, index) => ({ index })) } : {});

const blendBaseDraws = (samples: number): number => Math.max(1, Math.min(samples, BASE_DRAWS));

/** A verify cell without a plan prices `plainDraws` natural draws and hands on their outcome groups and states. */
export function plainVerifySample(
  root: SimPosition, p1Choice: string, p2Choice: string, plainDraws: number, matchupCache: MatchupCache, first?: PlainDraw,
): CellSample {
  const draws = cellSeeds(root, p1Choice, p2Choice).slice(0, plainDraws).map((seed, index) =>
    (index === 0 && first ? first : drawPlain(root, p1Choice, p2Choice, seed, matchupCache)));
  const value = draws.reduce((sum, draw) => sum + draw.leaf, 0) / draws.length;
  return { value, ended: draws[0].ended, firstChild: draws[0].child, outcomes: outcomeGroups(draws) };
}

function verifyPool(
  root: SimPosition, p1Choice: string, p2Choice: string, plainDraws: number, matchupCache: MatchupCache, first: PlainDraw, drawsMore: boolean,
): CellSample | null {
  const size = drawsMore ? plainDraws : Math.min(plainDraws, stateRuleFor(root).pool);
  const pool = plainVerifySample(root, p1Choice, p2Choice, size, matchupCache, first);
  return drawsMore || pool.outcomes!.length > 1 || pool.outcomes![0].groups ? pool : null;
}

// A chance miss of 16 draws leaves a class of weight 0.197 or less out; from 0.207 up the model has a gap.
/** The analytic weight of unreached classes from which on a blend cell prices as the mean of its draws. */
export const MISSING_WEIGHT_CUT = 0.2;

function advanceChild(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, scripts?: RollScripts): SimPosition {
  return scripts ? advancePositionWithLog(root, p1Choice, p2Choice, seed, { scripts }).child : advancePosition(root, p1Choice, p2Choice, seed);
}

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
  const seeds = cellSeeds(root, p1Choice, p2Choice);
  const firstChild = first?.child ?? advanceChild(root, p1Choice, p2Choice, seeds[0], scripts);
  const firstBattle = positionBattle(firstChild);
  const ended = firstBattle.ended;
  let sum = first?.leaf ?? leafValue(firstBattle, matchupCache);
  const rollMoves = rollSensitivePair(rootBattle, p1Choice, p2Choice);
  const draws = ended
    ? (rollMoves ? Math.max(samples, 3) : 1)
    : (countFainted(firstBattle) > rootFainted || rollMoves ? samples : 1);
  if (plainDraws) {
    const log = first?.log ?? advancePositionWithLog(root, p1Choice, p2Choice, seeds[0]).log;
    const pool = verifyPool(root, p1Choice, p2Choice, plainDraws, matchupCache, { child: firstChild, log, leaf: sum, ended }, draws > 1);
    if (pool) return pool;
  }
  for (let s = 1; s < draws; s++) {
    const child = advanceChild(root, p1Choice, p2Choice, seeds[s], scripts);
    sum += leafValue(positionBattle(child), matchupCache);
  }
  return { value: sum / draws, ended, firstChild, ...leadingDraws(draws) };
}

interface Draw {
  child: SimPosition;
  log: string[];
  leaf: number;
  ended: boolean;
  dice?: SecondaryRecord[];
}

interface ClassEntry {
  leafSum: number;
  count: number;
  hasFirst: boolean;
  ended: boolean;
  /** The class's first draw: the child the verify step deepens. */
  child: SimPosition;
  draws: Draw[];
}

function allDrawsSample(draws: Draw[]): CellSample {
  const value = draws.reduce((sum, draw) => sum + draw.leaf, 0) / draws.length;
  return { value, ended: draws[0].ended, firstChild: draws[0].child };
}

function drawCell(
  root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, matchupCache: MatchupCache, scripts?: RollScripts, record = false,
): Draw {
  const sink = record ? new DiceSink(scripts) : null;
  const given = sink ?? scripts;
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed, given ? { scripts: given } : undefined);
  const battle = positionBattle(child);
  return { child, log, leaf: leafValue(battle, matchupCache), ended: battle.ended, ...(sink ? { dice: sink.secondaries } : {}) };
}

function classifyDraw(
  classes: Map<string, ClassEntry>,
  expected: Map<string, number>,
  events: CellEvent[],
  draw: Draw,
  isFirst: boolean,
): boolean {
  const key = classifyChild(draw.log, events, draw.dice);
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
    const normalized = weight / weightTotal;
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

// A pool draw that reads into no planned class is left out: the pool never changes the plan's classes or weights.
function classPools(
  root: SimPosition, events: CellEvent[], p1Choice: string, p2Choice: string, plainDraws: number,
  matchupCache: MatchupCache, classes: Map<string, ClassEntry>, drawnBySeed: Map<string, Draw>,
): Map<string, Draw[]> {
  const record = hasSecondary(events);
  const pools = new Map([...classes].map(([key, cls]) => [key, [...cls.draws]]));
  for (const seed of cellSeeds(root, p1Choice, p2Choice).slice(0, plainDraws)) {
    if (drawnBySeed.has(String(seed))) continue;
    const draw = drawCell(root, p1Choice, p2Choice, seed, matchupCache, undefined, record);
    const key = classifyChild(draw.log, events, draw.dice);
    if (key !== null) pools.get(key)?.push(draw);
  }
  return pools;
}

function forceMissingClasses(
  root: SimPosition, events: CellEvent[], first: 'p1' | 'p2', expected: Map<string, number>, classes: Map<string, ClassEntry>,
  draws: Draw[], p1Choice: string, p2Choice: string, matchupCache: MatchupCache, scripts?: RollScripts,
): void {
  for (const [key, share] of expected) {
    if (classes.has(key) || !worthForcing(key, share)) continue;
    for (const aimed of scriptsFor(`${first}:${key}`, events, null)) {
      const draw = drawCell(root, p1Choice, p2Choice, cellSeeds(root, p1Choice, p2Choice)[0], matchupCache, mergeScripts(scripts, aimed), true);
      const landed = classifyChild(draw.log, events, draw.dice);
      if (landed === null || !expected.has(landed) || classes.has(landed)) continue;
      draws.push(draw);
      classifyDraw(classes, expected, events, draw, false);
      if (classes.has(key)) break;
    }
  }
}

function chaseMissingClasses(
  expected: Map<string, number>, classes: Map<string, ClassEntry>, draws: Draw[], drawSeed: (seed: PRNGSeed) => void, events: CellEvent[], seeds: readonly PRNGSeed[],
): boolean {
  for (
    let slot = BASE_DRAWS;
    [...expected.keys()].some(key => !classes.has(key)) && draws.length < BOUNDARY_DRAW_BUDGET && slot < seeds.length;
    slot++
  ) {
    drawSeed(seeds[slot]);
    if (!classifyDraw(classes, expected, events, draws[draws.length - 1], false)) return false;
  }
  return true;
}

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
  const record = hasSecondary(events);
  const drawSeed = (seed: PRNGSeed) => {
    draws.push(drawCell(root, p1Choice, p2Choice, seed, matchupCache, scripts, record));
    drawnBySeed.set(String(seed), draws[draws.length - 1]);
  };
  const baseDraws = blendBaseDraws(samples), seeds = cellSeeds(root, p1Choice, p2Choice);
  for (let s = 0; s < baseDraws; s++) drawSeed(seeds[s]);

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
  if (record) forceMissingClasses(root, events, first, expected, classes, draws, p1Choice, p2Choice, matchupCache, scripts);
  else if (!chaseMissingClasses(expected, classes, draws, drawSeed, events, seeds)) return fallback();

  const missing = [...expected.keys()].filter(key => !classes.has(key));
  let weightTotal = 0;
  for (const [key, weight] of expected) if (classes.has(key)) weightTotal += weight;
  if (weightTotal <= 0) return fallback();
  // A large unreached weight is a state effect the board cannot see (Weakness Policy): renormalising would drop it.
  if (missing.reduce((sum, key) => sum + expected.get(key)!, 0) >= MISSING_WEIGHT_CUT) {
    const diagnostic = unreachedDiagnostic(expected, classes, missing, p1Choice, p2Choice);
    return plainDraws ? { ...fallback(), diagnostic } : { ...allDrawsSample(draws), diagnostic };
  }
  const pools = plainDraws ? classPools(root, events, p1Choice, p2Choice, plainDraws, matchupCache, classes, drawnBySeed) : undefined;
  return blendFromClasses(expected, classes, weightTotal, missing, draws, p1Choice, p2Choice, pools);
}

// Class keys carry the order prefix (`p1:hit-kill`), as the pair plan's tie cells and the tree's root keys write them.
function mixOrders(first: CellSample, second: CellSample): CellSample {
  const mixed: CellSample = { value: (first.value + second.value) / 2, ended: first.ended && second.ended, firstChild: first.firstChild };
  const diagnostic = first.diagnostic ?? second.diagnostic;
  if (diagnostic) mixed.diagnostic = diagnostic;
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

// A child that ended the game is exact only without an accuracy or random roll: such cells take at least three seeds.
/** Prices one cell: one sim where nothing fainted, the full seed spread where a KO or an accuracy roll is in play. */
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
  if (blendRoot && rootBattle.gameType === 'doubles') {
    const pair = pairCellSample(root, p1Choice, p2Choice, samples, matchupCache, plainDraws);
    if (pair.kind === 'sample') return pair.sample;
    if (pair.kind === 'plain') return plainCellSample(root, rootBattle, rootFainted, p1Choice, p2Choice, samples, matchupCache, pair.first, plainDraws);
  }
  const plan = blendRoot ? planCellEvents(rootBattle, p1Choice, p2Choice) : null;
  const tied = blendRoot && speedTie(rootBattle, p1Choice, p2Choice);
  if (plainDraws && (plan?.kind === 'fail' || tied)) return plainVerifySample(root, p1Choice, p2Choice, plainDraws, matchupCache);
  const price = (scripts?: RollScripts): CellSample => {
    if (plan?.kind !== 'events') return plainCellSample(root, rootBattle, rootFainted, p1Choice, p2Choice, samples, matchupCache, undefined, plainDraws, scripts);
    const blended = blendCellSample(root, plan.events, p1Choice, p2Choice, samples, matchupCache, plainDraws, scripts);
    return plainDraws ? blended : { ...blended, ...leadingDraws(blendBaseDraws(samples)) };
  };
  if (tied && !plainDraws) {
    const orders = tieOrderScripts(p1Choice, p2Choice);
    return mixOrders(price(orders.p1), price(orders.p2));
  }
  return price();
}
