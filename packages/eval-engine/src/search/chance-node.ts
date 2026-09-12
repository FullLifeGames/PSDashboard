import type { MctsTreeStats } from '../types.ts';
import type { Node } from './mcts-node.ts';

/**
 * Round 43: the chance node. A boundary cell in the first two plies whose
 * pair carries a priced roll (or groups empirically by who fell) expands
 * into one child per outcome class. The descent hands the class with the
 * largest deficit (weight × visits − own visits) its visit, so the class
 * visits follow the weights within one visit without a hash; the cell's
 * value is the weighted blend of the class means, each with one static
 * prior like every tree cell.
 */
export interface ChanceClass {
  /** The sampler's class key (`hit-kill`, `miss`, `hit-nokill|hit-kill`); tie cells keep the order prefix (`p1:none`). */
  key: string;
  weight: number;
  /** Descents into this class (terminal children never reach backpropagation, so the node counts them). */
  visits: number;
  child: Node;
}

export interface ChanceNode {
  kind: 'chance';
  /** Descents through the node, the expansion included. */
  visits: number;
  /** The weighted static of the class children at creation: the expansion's leaf value. */
  value: number;
  /** Sorted by weight descending, then key ascending. */
  classes: ChanceClass[];
}

export type TreeChild = Node | ChanceNode;

export const isChanceNode = (child: TreeChild): child is ChanceNode => child.kind === 'chance';

/** Strips the order prefix of a non-tie group key so it matches the sampler's class keys. */
export const classKeyOf = (key: string, tie: boolean): string => (tie ? key : key.slice(key.indexOf(':') + 1));

export function makeChanceNode(classes: ChanceClass[]): ChanceNode {
  const sorted = [...classes].sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const value = sorted.reduce((sum, cls) => sum + cls.weight * cls.child.value, 0);
  return { kind: 'chance', visits: 1, value, classes: sorted };
}

/** The class with the largest deficit takes the descent (ties: list order); the node and the class count it. */
export function pickClass(node: ChanceNode): ChanceClass {
  let best = node.classes[0];
  let bestDeficit = -Infinity;
  for (const cls of node.classes) {
    const deficit = cls.weight * node.visits - cls.visits;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = cls;
    }
  }
  node.visits += 1;
  best.visits += 1;
  return best;
}

const leafOnly = (child: Node): boolean => child.ended || child.p1Options.length === 0 || child.p2Options.length === 0;
const sumW = (child: Node): number => child.p1W.reduce((sum, w) => sum + w, 0);

/** Leaves backed through the class: its own marginals, or its static per descent when the child is terminal. */
const classTotal = (cls: ChanceClass): number => (leafOnly(cls.child) ? cls.visits * cls.child.value : sumW(cls.child));

const classMean = (cls: ChanceClass): number => (classTotal(cls) + cls.child.value) / (cls.visits + 1);

export const chanceValue = (node: ChanceNode): number => node.classes.reduce((sum, cls) => sum + cls.weight * classMean(cls), 0);

export const chanceEnded = (node: ChanceNode): boolean => node.classes.every(cls => cls.child.ended);

/** One root cell's tree stats for the merge: a decision child as before, a chance child with its classes and a visit-mean-shaped total. */
export function cellStats(key: number, child: TreeChild, classKey?: string): MctsTreeStats['cells'][number] {
  if (!isChanceNode(child)) {
    return {
      key, visits: child.visits, total: sumW(child) + child.value, value: child.value, ended: child.ended,
      ...(classKey !== undefined ? { classKey } : {}),
    };
  }
  return {
    key,
    visits: child.visits,
    total: child.classes.reduce((sum, cls) => sum + classTotal(cls), 0) + child.value,
    value: child.value,
    ended: chanceEnded(child),
    classes: child.classes.map(cls => ({
      key: cls.key, weight: cls.weight, visits: cls.visits, total: classTotal(cls), value: cls.child.value, ended: cls.child.ended,
    })),
  };
}
