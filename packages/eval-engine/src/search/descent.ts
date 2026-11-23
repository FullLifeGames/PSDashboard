import { cellKey } from '../rank.ts';
import { expandCell, type ExpansionContext, type RootClassBook } from './expansion.ts';
import { pick, type Node } from './mcts-node.ts';

/**
 * One iteration of the tree is two halves: the descent through the existing cells by decoupled UCB with one expansion, and the
 * backpropagation of the leaf along the joint path. The tree's loop (`mcts.ts`) starts at the root and the line pass
 * (`search/line-pass.ts`) at a root cell's child, so the same code serves both.
 */

/** One joint step of the descent: a node and the cell (i, j) chosen in it. */
export interface PathStep {
  node: Node;
  i: number;
  j: number;
}

/**
 * Selection: descend through existing children via decoupled UCB, expanding at most one child. Returns the joint path, the leaf
 * value the descent ended on, and the depth it reached. `from` starts the descent below the root (the path then holds no root
 * step; the root's class book is never read).
 */
export function selectAndExpand(
  root: Node, iteration: number, seedOffset: number, ctx: ExpansionContext, book: RootClassBook | undefined, from: Node = root,
): { path: PathStep[]; leaf: number; depth: number } {
  const path: PathStep[] = [];
  let node = from;
  let leaf: number;
  let depth = 1;
  for (;;) {
    if (node.ended || node.p1Options.length === 0 || node.p2Options.length === 0) {
      leaf = node.value;
      break;
    }
    const i = pick(node.p1N, node.p1W, node.visits, true, node.p1Order);
    const j = pick(node.p2N, node.p2W, node.visits, false, node.p2Order);
    path.push({ node, i, j });
    const key = cellKey(i, j);
    const existing = node.children.get(key);
    if (!existing) {
      // Expansion (search/expansion.ts): one outcome per cell, from the iteration-rotated seed.
      const expanded = expandCell(node, i, j, iteration, seedOffset, ctx, node === root ? book : undefined);
      node.children.set(key, expanded.child);
      expanded.child.visits += 1;
      leaf = expanded.leaf;
      if (expanded.boundary) depth += 1;
      break;
    }
    node = existing;
    if (node.boundary) depth += 1;
  }
  return { path, leaf, depth };
}

/** Backpropagation along the joint path. */
export function backpropagate(path: PathStep[], leaf: number): void {
  for (const step of path) {
    step.node.visits += 1;
    step.node.p1N[step.i] += 1;
    step.node.p1W[step.i] += leaf;
    step.node.p2N[step.j] += 1;
    step.node.p2W[step.j] += leaf;
  }
}
