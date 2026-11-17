import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { rollsStall } from '../dex-facts/protect.ts';
import { positionBattle } from '../forward-model.ts';
import { parsePairChoice } from '../pair/guards.ts';
import type { EndgameChild, EndgameChildren } from './children.ts';
import { delayFacts, heldStall, stallMargin, STALL_VOLATILE } from './delay-facts.ts';
import { other, type Side } from './prover-order.ts';

/**
 * Round 89 (P2, 1.2.0): the delay rule of the forced-win prover. A foe that repeats a stalling move (Protect and its kin, Endure) holds
 * with a chance that only falls along a chain, and the chain ends with its PP. A cell in which a foe body that carries the stall volatile
 * clicks a stalling move that rolls (`rollsStall`) is a repeat; a child of that cell is a delay when it did not end and its delay facts
 * equal the parent's (`delay-facts.ts`: the same board, HP kept, up to the foe's stall counter and the PP the margin covers), whether the
 * repeat held (`heldStall`) or failed and the foe still stands (an attack that missed: the stall is reset, the next use is sure and the
 * chain goes on).
 *
 * The rule applies when some child is a delay, every child in which the repeat held is one, and the own choice keeps the PP margin
 * (`stallMargin`). Then the cell is worth X = (the share-weighted mass of the other children) / (1 - the delays' share), and the proof
 * names the stalling move. Soundness, by induction over the foe's stall PP: let W be the least cell mass the other replies give at the
 * parent (a delay child has the parent's facts, so the other replies meet the same boards there). A delay child is the parent with another
 * stall counter and one stall PP less; the other children lose the volatile, so their positions do not depend on the counter, and their
 * relative shares are the side's own dice. With no stall PP left the foe has no stall reply and the value is W; otherwise the cell is worth
 * at least X (1 - d) + d min(W, X) >= min(W, X) for d the delay share, so the parent is worth at least min(W, X), the value the AND node
 * takes. The margin keeps the side's own choice legal along the chain. A held child that is no delay (a heal, a status, the partner's hit,
 * a contact shield's damage, a stage raised) refuses the rule for the whole cell.
 *
 * A cell whose draws split the end (the hold keeps the board, the failure knocks the foe out) is unpriced on the plain path, and no proof
 * runs through it; here its read through the recorded dice (`EndgameChildren.delaySplit`) stands in for it, and only when the rule fires.
 * Outside a repeated stall nothing in this module reads a cell.
 */

/** The cell a delay is read from: the prover's `Cell` without its reply. */
export type DelayCell = Pick<EndgameChildren, 'unpriced' | 'plain' | 'children' | 'delaySplit'> & { p1Choice: string; p2Choice: string };

export interface DelayRead {
  /** The id of the stalling move the foe repeats. */
  move: string;
  /** The children the proof reads: the cell's own, or its split through the recorded dice. */
  children: EndgameChild[];
  /** Whether `children[i]` is a delay. */
  delays: boolean[];
  /** The children come from `delaySplit` because the cell is unpriced. */
  split: boolean;
}

/** The stalling move a foe body that carries the stall volatile clicks in the foe's choice, or null (the move's id from the Dex). */
export function stallClick(battle: Battle, foe: Side, foeChoice: string): string | null {
  const index = sideIndex(foe);
  for (const action of parsePairChoice(battle, index, foeChoice) ?? []) {
    if (action.kind !== 'move') continue;
    const body = battle.sides[index].active[action.slot];
    const move = battle.dex.moves.get(action.moveId);
    if (body && !body.fainted && body.volatiles[STALL_VOLATILE] && move.exists && rollsStall(battle.dex, move)) return move.id;
  }
  return null;
}

/**
 * The delay reading of a cell for `side`'s proof at the position `root`, or null when the rule does not apply (no repeated stall in the
 * cell, no delay child, a held child that is no delay, the margin refused, or an unpriced cell without a read through its dice).
 */
export function readDelay(root: Battle, side: Side, cell: DelayCell): DelayRead | null {
  const [own, foeChoice] = side === 'p1' ? [cell.p1Choice, cell.p2Choice] : [cell.p2Choice, cell.p1Choice];
  const foe = other(side);
  const move = stallClick(root, foe, foeChoice);
  if (!move) return null;
  const split = cell.unpriced && cell.plain;
  const children = split ? cell.delaySplit?.() ?? null : cell.children;
  if (!children) return null;
  const parent = delayFacts(root, foe);
  const reads = children.map(child => {
    if (child.ended) return { held: false, delay: false };
    const battle = positionBattle(child.position);
    return { held: heldStall(root, battle, foe), delay: delayFacts(battle, foe) === parent };
  });
  if (!reads.some(read => read.delay) || reads.some(read => read.held && !read.delay)) return null;
  if (!stallMargin(root, side, own)) return null;
  return { move, children, delays: reads.map(read => read.delay), split };
}

/** The mass of a delay cell: the other children's mass over the share they hold (a share no child carries stays at 0). */
export const delayMass = (otherMass: number, delayShare: number): number => (1 - delayShare > 1e-12 ? Math.min(1, otherMass / (1 - delayShare)) : 0);
