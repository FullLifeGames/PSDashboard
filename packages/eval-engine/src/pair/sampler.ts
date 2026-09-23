import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePosition, positionBattle, type SimPosition } from '../forward-model.ts';
import { PROBE_SEEDS } from '../cell-blend.ts';
import type { CellBlendClass } from '../types.ts';
import { leafValue, SEARCH_SEEDS } from '../search/leaf.ts';
import type { CellSample } from '../search/cell-sampler.ts';
import { drawPair, type PairDraw } from './draw.ts';
import { parsePairChoice, planTimeFallback } from './guards.ts';
import { memoKillTable, type KillTable } from './kill-table.ts';
import { readPattern, type PairEvent, type PairOutcome, type Pattern, type PatternRead, type TableFor } from './pattern.ts';
import type { PairScript } from './prng.ts';

/**
 * Round 56: a doubles root cell priced as the weighted mix of its outcome
 * classes. The first natural draw names the events; the heaviest outcome no
 * draw showed yet is drawn next with the dice answering that one event the
 * other way (everything before it replays as drawn); each class weighs the
 * product of its events' probabilities. Stops at a coverage of 0.95, after
 * eight draws, or when no candidate carries 0.01 of mass. A cell without
 * events keeps today's plain path; a rule the plan does not price sends the
 * cell to the plain mean over eight natural draws (spec rules A to G).
 */

/** Draws per cell, base draws included. */
export const PAIR_DRAW_BUDGET = 8;
/** The fallback's natural draws: the five search seeds and the first three probe seeds. */
export const FALLBACK_SEEDS: readonly PRNGSeed[] = [...SEARCH_SEEDS, ...PROBE_SEEDS.slice(0, 3)];
const COVER_TARGET = 0.95;
const COVER_MIN = 0.8;
const COVER_MAX = 1.02;
const MIN_MASS = 0.01;
const NO_SCRIPTS: ReadonlyMap<string, PairScript> = new Map();

export interface FirstDraw { child: SimPosition; leaf: number; ended: boolean }

export type PairCell =
  | { kind: 'skip' }
  | { kind: 'plain'; first: FirstDraw }
  | { kind: 'sample'; sample: CellSample; via: 'plan' | 'fallback'; reason: string | null; draws: number };

interface Branch { seed: PRNGSeed; scripts: ReadonlyMap<string, PairScript>; from: number }
interface Found { key: string; weight: number; leafSum: number; count: number; ended: boolean; hasFirst: boolean; events: PairEvent[]; branch: Branch }
interface Candidate { id: string; prior: number; branch: Branch; prefix: PairEvent[]; flipKey: string; outcome: PairOutcome }
interface Cell { root: SimPosition; p1Choice: string; p2Choice: string; samples: number; matchupCache: MatchupCache; tableFor: TableFor }

const memos = new WeakMap<SimPosition, Map<string, KillTable | null>>();

/** Kill tables memoized per root. */
function tablesFor(root: SimPosition): TableFor {
  let memo = memos.get(root);
  if (!memo) {
    memo = new Map();
    memos.set(root, memo);
  }
  const perRoot = memo;
  return snapshot => memoKillTable(perRoot, snapshot);
}

const drawn = (cell: Cell, seed: PRNGSeed, scripts: ReadonlyMap<string, PairScript>): PairDraw =>
  drawPair(cell.root, cell.p1Choice, cell.p2Choice, seed, scripts, cell.matchupCache);

const read = (cell: Cell, draw: PairDraw): PatternRead =>
  readPattern(draw.records, draw.log, positionBattle(cell.root).dex, cell.tableFor);

/** Rule F: the plain mean over the eight fallback seeds; the first natural draw is reused where there is one. */
function fallbackCell(cell: Cell, first: PairDraw | null, reason: string, spent: number): PairCell {
  const leaves: number[] = [];
  let firstChild = first?.child;
  let ended = first?.ended ?? false;
  FALLBACK_SEEDS.forEach((seed, index) => {
    if (index === 0 && first) {
      leaves.push(first.leaf);
      return;
    }
    const child = advancePosition(cell.root, cell.p1Choice, cell.p2Choice, seed);
    const battle = positionBattle(child);
    if (index === 0) {
      firstChild = child;
      ended = battle.ended;
    }
    leaves.push(leafValue(battle, cell.matchupCache));
  });
  const value = leaves.reduce((sum, leaf) => sum + leaf, 0) / leaves.length;
  const draws = spent + FALLBACK_SEEDS.length - (first ? 1 : 0);
  return { kind: 'sample', sample: { value, ended, firstChild: firstChild! }, via: 'fallback', reason, draws };
}

/** Every outcome of an event behind the branch's own flip that carries at least MIN_MASS. */
function candidatesOf(found: Found): Candidate[] {
  const out: Candidate[] = [];
  let prefix = 1;
  found.events.forEach((event, index) => {
    for (const alternative of index > found.branch.from ? event.alternatives : []) {
      const prior = prefix * alternative.probability;
      if (prior < MIN_MASS) continue;
      const scripts = new Map(found.branch.scripts).set(event.key, alternative.script);
      const id = `${found.branch.seed}#${[...scripts].map(([key, script]) => `${key}=${JSON.stringify(script)}`).sort().join(';')}`;
      out.push({ id, prior, branch: { seed: found.branch.seed, scripts, from: index }, prefix: found.events.slice(0, index), flipKey: event.key, outcome: alternative.outcome });
    }
    prefix *= event.probability;
  });
  return out;
}

/** The heaviest untried candidate; ties go to the smaller id, so every run draws the same. */
function nextCandidate(candidates: Map<string, Candidate>, tried: Set<string>): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of candidates.values()) {
    if (tried.has(candidate.id)) continue;
    if (!best || candidate.prior > best.prior || (candidate.prior === best.prior && candidate.id < best.id)) best = candidate;
  }
  return best;
}

/** Rule F7: the prefix replayed as drawn and the flipped event came out as asked ('hit' asks for any hit). */
function landed(events: PairEvent[], candidate: Candidate): boolean {
  const index = candidate.prefix.length;
  for (let i = 0; i < index; i++) {
    if (events[i]?.key !== candidate.prefix[i].key || events[i].outcome !== candidate.prefix[i].outcome) return false;
  }
  const flipped = events[index];
  if (!flipped || flipped.key !== candidate.flipKey) return false;
  return candidate.outcome === 'hit' ? flipped.outcome !== 'miss' : flipped.outcome === candidate.outcome;
}

function record(found: Map<string, Found>, candidates: Map<string, Candidate>, pattern: Pattern, draw: PairDraw, branch: Branch, isFirst: boolean): void {
  let entry = found.get(pattern.key);
  if (!entry) {
    entry = { key: pattern.key, weight: pattern.weight, leafSum: 0, count: 0, ended: true, hasFirst: false, events: pattern.events, branch };
    found.set(pattern.key, entry);
    for (const candidate of candidatesOf(entry)) if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
  }
  entry.leafSum += draw.leaf;
  entry.count += 1;
  entry.ended = entry.ended && draw.ended;
  entry.hasFirst = entry.hasFirst || isFirst;
}

const coverage = (found: Map<string, Found>) => [...found.values()].reduce((sum, entry) => sum + entry.weight, 0);

/** Rule G: the class means weighted by the class weights over the coverage, in the CellBlend shape deepening and the verify merge read. */
function blended(found: Map<string, Found>, first: PairDraw, cover: number): CellSample {
  const classes: CellBlendClass[] = [...found.values()].map(entry => ({
    key: entry.key, weight: entry.weight / cover, leafSum: entry.leafSum, count: entry.count, hasFirst: entry.hasFirst, ended: entry.ended,
  }));
  const value = classes.reduce((sum, cls) => sum + cls.weight * (cls.leafSum / cls.count), 0);
  return { value, ended: classes.every(cls => cls.ended), firstChild: first.child, blend: { classes, firstLeaf: first.leaf } };
}

/** Rules A.4 and E: the remaining base seeds, then the flips, then the coverage check. */
function plan(cell: Cell, first: PairDraw, firstPattern: Pattern): PairCell {
  const found = new Map<string, Found>();
  const candidates = new Map<string, Candidate>();
  record(found, candidates, firstPattern, first, { seed: SEARCH_SEEDS[0], scripts: NO_SCRIPTS, from: -1 }, true);
  let draws = 1;
  const base = Math.max(1, Math.min(cell.samples, SEARCH_SEEDS.length));
  for (let s = 1; s < base; s++) {
    const draw = drawn(cell, SEARCH_SEEDS[s], NO_SCRIPTS);
    draws += 1;
    const pattern = read(cell, draw);
    if (pattern.kind === 'fallback') return fallbackCell(cell, first, pattern.reason, draws);
    record(found, candidates, pattern, draw, { seed: SEARCH_SEEDS[s], scripts: NO_SCRIPTS, from: -1 }, false);
  }
  const tried = new Set<string>();
  while (draws < PAIR_DRAW_BUDGET && coverage(found) < COVER_TARGET) {
    const next = nextCandidate(candidates, tried);
    if (!next) break;
    tried.add(next.id);
    const draw = drawn(cell, next.branch.seed, next.branch.scripts);
    draws += 1;
    const pattern = read(cell, draw);
    if (pattern.kind === 'fallback') return fallbackCell(cell, first, pattern.reason, draws);
    if (!landed(pattern.events, next)) return fallbackCell(cell, first, 'flip-missed', draws);
    record(found, candidates, pattern, draw, next.branch, false);
  }
  const cover = coverage(found);
  if (cover < COVER_MIN || cover > COVER_MAX) return fallbackCell(cell, first, cover < COVER_MIN ? 'low-cover' : 'over-cover', draws);
  return { kind: 'sample', sample: blended(found, first, cover), via: 'plan', reason: null, draws };
}

export function pairCellSample(root: SimPosition, p1Choice: string, p2Choice: string, samples: number, matchupCache: MatchupCache): PairCell {
  const battle = positionBattle(root);
  const p1 = parsePairChoice(battle, 0, p1Choice);
  const p2 = parsePairChoice(battle, 1, p2Choice);
  if (!p1 || !p2) return { kind: 'skip' };
  const cell: Cell = { root, p1Choice, p2Choice, samples, matchupCache, tableFor: tablesFor(root) };
  const early = planTimeFallback(battle, [p1, p2]);
  if (early) return fallbackCell(cell, null, early, 0);
  const first = drawn(cell, SEARCH_SEEDS[0], NO_SCRIPTS);
  const pattern = read(cell, first);
  if (pattern.kind === 'fallback') return fallbackCell(cell, first, pattern.reason, 1);
  if (pattern.events.length === 0) return { kind: 'plain', first: { child: first.child, leaf: first.leaf, ended: first.ended } };
  return plan(cell, first, pattern);
}
