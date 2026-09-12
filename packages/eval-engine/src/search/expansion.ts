import type { Battle, PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import { classifyChild, planCellEvents, type CellEvent } from '../cell-blend.ts';
import { cellKey } from '../rank.ts';
import type { TeraAllowance } from '../types.ts';
import { makeNode, type Node } from './mcts-node.ts';
import { classKeyOf, makeChanceNode, type TreeChild } from './chance-node.ts';
import { classChildren, groupedChildren, type OutcomeChildren } from './outcome-children.ts';
import { SEARCH_SEEDS } from './leaf.ts';

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

/** One child from a plain advance; a root boundary cell records the drawn class from the log. */
function singleChild(
  node: Node, p1Choice: string, p2Choice: string, seed: PRNGSeed, ctx: ExpansionContext, book: RootClassBook | undefined, key: number,
): Expanded {
  const { child, log, pendingSwitch } = advancePositionWithLog(node.position, p1Choice, p2Choice, seed, { stopAtForcedSwitch: ctx.stopAtForcedSwitch });
  const made = nodeFrom(child, pendingSwitch, ctx);
  if (book) {
    const events = rootEvents(book, key, p1Choice, p2Choice);
    const classKey = events ? classifyChild(log, events) : null;
    if (classKey !== null) book.keys.set(key, classKey);
  }
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
    return singleChild(node, p1Choice, p2Choice, SEARCH_SEEDS[(iteration + seedOffset) % SEARCH_SEEDS.length], ctx, book, key);
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
