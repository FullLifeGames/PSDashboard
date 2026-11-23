import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { rollsStall } from '../dex-facts/protect.ts';
import { positionBattle } from '../forward-model.ts';
import { parsePairChoice } from '../pair/guards.ts';
import type { EndgameChild, EndgameChildren } from './children.ts';
import { delayFacts, heldStall, stallMargin, STALL_VOLATILE } from './delay-facts.ts';
import { other, type Side } from './prover-order.ts';

/** The delay rule of the forced-win prover: a repeated stalling move that leaves the board as it was is a delay (EVALUATION.md, the forced-win prover). */

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
 * The delay reading of a cell for `side`'s proof at the position `root`. A cell is a repeat when a foe body that carries the stall
 * volatile clicks a stalling move that rolls (`rollsStall`); a child is a delay when it did not end and its delay facts equal the parent's,
 * whether the repeat held (`heldStall`) or failed with the foe still standing (an attack that missed resets the stall, so the next use is sure).
 * Null when the rule does not apply: no repeat, no delay child, a held child that is no delay (a heal, a status, the partner's hit, a contact
 * shield's damage, a stage raised), the PP margin refused, or an unpriced cell without a read through its dice (`delaySplit`).
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
