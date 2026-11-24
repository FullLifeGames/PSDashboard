import type { Battle, PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePositionWithLog, type SimPosition } from '../forward-model.ts';
import { classifyChild, drawnClassWeight, planCellEvents, type CellEvent } from '../cell-blend.ts';
import { DiceSink, QuantileSink, type SecondaryRecord } from '../forward/scripted-prng.ts';
import { cellHash, RootQuantiles, type DieQuantiles } from './root-quantile.ts';
import { hasSecondary } from './secondary-classes.ts';
import { cellKey } from '../rank.ts';
import type { TeraAllowance } from '../types.ts';
import { makeNode, type Node } from './mcts-node.ts';
import { keyedAdvance } from '../pair/tree-key.ts';
import { speedTie, treeSeed } from './leaf.ts';

/** A tree cell expands to one child from one simulator outcome, seeded by treeSeed(iteration, seedOffset); ADR 0023. */
export interface ExpansionContext {
  tera: TeraAllowance;
  matchupCache: MatchupCache;
  sleepClause?: boolean;
}

/** Root bookkeeping: the planned events per root cell and the drawn class of single-child boundary cells. */
export interface RootClassBook {
  battle: Battle;
  events: Map<number, CellEvent[] | null>;
  keys: Map<number, string>;
  /** The plan's chance of each booked class; the merge weighs a keyed cell by it. */
  weights: Map<number, number>;
  /** The tree's place among the search's trees; set only inside the budget's tree count, where draws spread dice. */
  quantiles?: { salt: number; offset: number; trees: number };
}

export interface Expanded {
  child: Node;
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

function movedFirst(log: string[]): 'p1' | 'p2' | null {
  const line = log.find(entry => entry.startsWith('|move|p1a:') || entry.startsWith('|move|p2a:'));
  return line ? (line.startsWith('|move|p1a:') ? 'p1' : 'p2') : null;
}

function doublesRootChild(
  node: Node, p1Choice: string, p2Choice: string, seed: PRNGSeed, ctx: ExpansionContext, book: RootClassBook, key: number,
  quantiles?: DieQuantiles,
): Expanded | null {
  if (book.battle.gameType !== 'doubles') return null;
  const keyed = keyedAdvance(book, node.position, key, p1Choice, p2Choice, seed, quantiles);
  if (!keyed) return null;
  const made = nodeFrom(keyed.child, keyed.pendingSwitch, ctx);
  if (keyed.classKey !== null) {
    book.keys.set(key, keyed.classKey);
    if (keyed.classWeight !== null) book.weights.set(key, keyed.classWeight);
  }
  return { child: made, leaf: made.value, boundary: made.boundary };
}

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

function drawSink(quantiles: DieQuantiles | undefined, book: RootClassBook | undefined, recording: boolean): DiceSink | null {
  if (quantiles && book?.battle.gameType !== 'doubles') return new QuantileSink(quantiles);
  return recording ? new DiceSink() : null;
}

function singleChild(
  node: Node, p1Choice: string, p2Choice: string, seed: PRNGSeed, ctx: ExpansionContext, book: RootClassBook | undefined, key: number,
): Expanded {
  const events = book ? rootEvents(book, key, p1Choice, p2Choice) : null;
  const q = book?.quantiles;
  const quantiles = q ? new RootQuantiles(cellHash(q.salt, p1Choice, p2Choice), q.offset, q.trees) : undefined;
  const keyed = book && !events ? doublesRootChild(node, p1Choice, p2Choice, seed, ctx, book, key, quantiles) : null;
  if (keyed) return keyed;
  const recording = !!events && hasSecondary(events);
  const sink = drawSink(quantiles, book, recording);
  const { child, log, pendingSwitch } = advancePositionWithLog(node.position, p1Choice, p2Choice, seed, {
    stopAtForcedSwitch: true, ...(sink ? { scripts: sink } : {}),
  });
  const made = nodeFrom(child, pendingSwitch, ctx);
  if (book && events) bookDrawnClass(book, key, events, log, recording ? sink?.secondaries : undefined, () => speedTie(book.battle, p1Choice, p2Choice));
  return { child: made, leaf: made.value, boundary: made.boundary };
}

/** The child one cell expands to: one simulator outcome with its leaf value and whether it opens a boundary. */
export function expandCell(
  node: Node, i: number, j: number, iteration: number, seedOffset: number, ctx: ExpansionContext, book?: RootClassBook,
): Expanded {
  const p1Choice = node.p1Options[i].choice;
  const p2Choice = node.p2Options[j].choice;
  return singleChild(node, p1Choice, p2Choice, treeSeed(iteration, seedOffset), ctx, book, cellKey(i, j));
}
