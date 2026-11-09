import type { Battle, PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import { classifyChild, drawnClassWeight, planCellEvents, type CellEvent } from '../cell-blend.ts';
import { DiceSink, QuantileSink, type SecondaryRecord } from '../forward/scripted-prng.ts';
import { cellHash, RootQuantiles, type DieQuantiles } from './root-quantile.ts';
import { hasSecondary } from './secondary-classes.ts';
import { cellKey } from '../rank.ts';
import type { TeraAllowance } from '../types.ts';
import { makeNode, type Node } from './mcts-node.ts';
import { classKeyOf, makeChanceNode, type TreeChild } from './chance-node.ts';
import { keyedAdvance } from '../pair/tree-key.ts';
import { classChildren, groupedChildren, type OutcomeChildren } from './outcome-children.ts';
import { SEARCH_SEEDS, speedTie, treeSeed } from './leaf.ts';

/**
 * Round 43: how a tree cell expands. In the first two plies every tree
 * draws the same worlds: a boundary cell with a class plan becomes a
 * chance node over its outcome classes (one forced draw per class the
 * base seed never showed), a pair without a plan groups three fixed seeds
 * by who fell, a deterministic singles pair takes seed one, and so does
 * every expansion out of a mid-turn node. From the third ply on the
 * iteration-rotated seed fixes one outcome per cell as before, so sibling
 * trees still diverge deeper down. The roadmap's fallback for a failed
 * gate is CHANCE_NODES = false (today's tree, unchanged) — and that is
 * where the round-43 verdict left it: the chance nodes cost 12 to 15 bp
 * of late Brier on the paired bank (the visits split across the classes
 * halve the main line's depth over two plies), +44 to +70 % tree time in
 * doubles, and the round-42 play-out line; the on-demand draws of the
 * solver and the prover stayed. The machinery below is kept, switched
 * off, for the next attempt at pricing chance in the tree.
 */
export const CHANCE_NODES = false;
const CHANCE_MAX_DEPTH = 2;
const TREE_FORCED_CAP = 6;
const GROUP_SEEDS = SEARCH_SEEDS.slice(0, 3);
/** Empirical grouping of unplanned pairs only up to this ply (the class path runs to CHANCE_MAX_DEPTH). */
const GROUP_MAX_DEPTH = 1;

export interface ExpansionContext {
  tera: TeraAllowance;
  matchupCache: MatchupCache;
  sleepClause?: boolean;
  stopAtForcedSwitch: boolean;
}

/** Root bookkeeping: the planned events per root cell (one calc each) and the drawn class of single-child boundary cells (round 33). */
export interface RootClassBook {
  battle: Battle;
  events: Map<number, CellEvent[] | null>;
  keys: Map<number, string>;
  /** Round 89 (#59): the plan's chance of each booked class, beside its key (the merge weighs a keyed cell by it). */
  weights: Map<number, number>;
  /** Round 89 (#59): the tree's place among the search's trees; set only for a tree inside the budget's tree count, where the root draws spread their dice. */
  quantiles?: { salt: number; offset: number; trees: number };
}

export interface Expanded {
  child: TreeChild;
  leaf: number;
  boundary: boolean;
}

const nodeFrom = (position: SimPosition, pendingSwitch: boolean, ctx: ExpansionContext): Node =>
  makeNode(position, ctx.tera, ctx.matchupCache, undefined, ctx.sleepClause, !pendingSwitch);

function rootEvents(book: RootClassBook, key: number, p1Choice: string, p2Choice: string): CellEvent[] | null {
  let events = book.events.get(key);
  if (events === undefined) {
    const plan = planCellEvents(book.battle, p1Choice, p2Choice);
    events = plan.kind === 'events' ? plan.events : null;
    book.events.set(key, events);
  }
  return events;
}

/** The side whose move line the log shows first (the sampler's order prefix of a tied cell), null when neither moved. */
function movedFirst(log: string[]): 'p1' | 'p2' | null {
  const line = log.find(entry => entry.startsWith('|move|p1a:') || entry.startsWith('|move|p2a:'));
  return line ? (line.startsWith('|move|p1a:') ? 'p1' : 'p2') : null;
}

/**
 * Round 86 (A9b): a doubles root cell has no analytic plan, so it draws under the pair recorder and names its class the way the
 * pair plan names the sampler's. Null for a singles root and for a cell the pair plan never reads (the caller draws plainly). The
 * tree below the root stays flat and unkeyed.
 */
function doublesRootChild(
  node: Node, p1Choice: string, p2Choice: string, seed: PRNGSeed, ctx: ExpansionContext, book: RootClassBook, key: number,
  quantiles?: DieQuantiles,
): Expanded | null {
  if (book.battle.gameType !== 'doubles') return null;
  const keyed = keyedAdvance(book, node.position, key, p1Choice, p2Choice, seed, ctx.stopAtForcedSwitch, quantiles);
  if (!keyed) return null;
  const made = nodeFrom(keyed.child, keyed.pendingSwitch, ctx);
  if (keyed.classKey !== null) {
    book.keys.set(key, keyed.classKey);
    if (keyed.classWeight !== null) book.weights.set(key, keyed.classWeight);
  }
  return { child: made, leaf: made.value, boundary: made.boundary };
}

/**
 * Books the class one singles root draw showed, with its weight (round 89, #59): the sampler's chance of the class, as the fold gives
 * it for the order this log shows, and half of it in a tied cell, whose two orders the sampler prices at one half each.
 */
function bookDrawnClass(
  book: RootClassBook, key: number, events: CellEvent[], log: string[], dice: SecondaryRecord[] | undefined, tied: () => boolean,
): void {
  const classKey = classifyChild(log, events, dice);
  if (classKey === null) return;
  const order = tied() ? movedFirst(log) : null;
  book.keys.set(key, order ? `${order}:${classKey}` : classKey);
  const first = order ?? movedFirst(log);
  const weight = events.length === 1 ? drawnClassWeight(events, classKey, 'p1') : first ? drawnClassWeight(events, classKey, first) : null;
  if (weight !== null) book.weights.set(key, order ? weight / 2 : weight);
}

/** The sink of a singles root draw: the quantiles when the tree spreads its dice (a doubles cell the pair plan never reads keeps the stream), else the recorder of the secondary dice. */
function drawSink(quantiles: DieQuantiles | undefined, book: RootClassBook | undefined, recording: boolean): DiceSink | null {
  if (quantiles && book?.battle.gameType !== 'doubles') return new QuantileSink(quantiles);
  return recording ? new DiceSink() : null;
}

/**
 * One child from a plain advance; a root boundary cell records the drawn class from the log. Round 69 (T146 c5): a
 * tied singles cell's sampler classes carry the order (`p1:hit-kill|none`), so the drawn class names the order the
 * coin flip gave this tree, and the merge finds the class its pool belongs to. Round 86 (T305): a root cell with a secondary
 * die draws under a recording sink, so the drawn class names the effects whose die came true (`hit-nokill+brn`), as the
 * sampler's classes do; the tree below the root stays flat. Round 86 (A9b): a doubles root cell books the pair plan's key.
 */
function singleChild(
  node: Node, p1Choice: string, p2Choice: string, seed: PRNGSeed, ctx: ExpansionContext, book: RootClassBook | undefined, key: number,
): Expanded {
  const events = book ? rootEvents(book, key, p1Choice, p2Choice) : null;
  // Round 89 (#59): inside the budget's tree count, tree k answers the named dice of this root draw by quantile
  const q = book?.quantiles;
  const quantiles = q ? new RootQuantiles(cellHash(q.salt, p1Choice, p2Choice), q.offset, q.trees) : undefined;
  const keyed = book && !events ? doublesRootChild(node, p1Choice, p2Choice, seed, ctx, book, key, quantiles) : null;
  if (keyed) return keyed;
  const recording = !!events && hasSecondary(events);
  const sink = drawSink(quantiles, book, recording);
  const { child, log, pendingSwitch } = advancePositionWithLog(node.position, p1Choice, p2Choice, seed, {
    stopAtForcedSwitch: ctx.stopAtForcedSwitch, ...(sink ? { scripts: sink } : {}),
  });
  const made = nodeFrom(child, pendingSwitch, ctx);
  if (book && events) bookDrawnClass(book, key, events, log, recording ? sink?.secondaries : undefined, () => speedTie(book.battle, p1Choice, p2Choice));
  return { child: made, leaf: made.value, boundary: made.boundary };
}

/**
 * Class path where a plan or a tie exists, empirical grouping where the plan
 * fails, null for a deterministic singles pair. The empirical grouping
 * (doubles, guarded pairs: three draws per cell) runs at the root ply only;
 * the perf gate measured it at +102 to +152 % tree cost on the doubles
 * probe when the second ply grouped as well (2026-09-12 ladder step 1).
 */
function groupedDraw(position: SimPosition, p1Choice: string, p2Choice: string, depth: number, ctx: ExpansionContext): OutcomeChildren | null {
  const plan = planCellEvents(positionBattle(position), p1Choice, p2Choice);
  if (plan.kind === 'fail') {
    if (depth > GROUP_MAX_DEPTH) return null;
    return groupedChildren(position, p1Choice, p2Choice, { seeds: GROUP_SEEDS, stopAtForcedSwitch: ctx.stopAtForcedSwitch });
  }
  return classChildren(position, p1Choice, p2Choice, { baseSeeds: [SEARCH_SEEDS[0]], forcedCap: TREE_FORCED_CAP, stopAtForcedSwitch: ctx.stopAtForcedSwitch });
}

export function expandCell(
  node: Node, i: number, j: number, depth: number, iteration: number, seedOffset: number, ctx: ExpansionContext, book?: RootClassBook,
): Expanded {
  const p1Choice = node.p1Options[i].choice;
  const p2Choice = node.p2Options[j].choice;
  const key = cellKey(i, j);
  if (!CHANCE_NODES || depth > CHANCE_MAX_DEPTH) {
    return singleChild(node, p1Choice, p2Choice, treeSeed(iteration, seedOffset), ctx, book, key);
  }
  if (!node.boundary) return singleChild(node, p1Choice, p2Choice, SEARCH_SEEDS[0], ctx, book, key);
  const grouped = groupedDraw(node.position, p1Choice, p2Choice, depth, ctx);
  if (!grouped || grouped.children.length === 0) return singleChild(node, p1Choice, p2Choice, SEARCH_SEEDS[0], ctx, book, key);
  // Class-path keys drop their order prefix (the sampler's class keys); faint signatures of the empirical path stay whole.
  const bareKey = (groupKey: string) => (grouped.events.length > 0 ? classKeyOf(groupKey, grouped.tie) : groupKey);
  if (grouped.children.length === 1) {
    const only = grouped.children[0];
    const made = nodeFrom(only.position, only.pendingSwitch, ctx);
    if (book && grouped.events.length > 0) book.keys.set(key, bareKey(only.key));
    return { child: made, leaf: made.value, boundary: made.boundary };
  }
  const chance = makeChanceNode(grouped.children.map(child => ({
    key: bareKey(child.key), weight: child.weight, visits: 0, child: nodeFrom(child.position, child.pendingSwitch, ctx),
  })));
  return { child: chance, leaf: chance.value, boundary: chance.classes[0].child.boundary };
}
