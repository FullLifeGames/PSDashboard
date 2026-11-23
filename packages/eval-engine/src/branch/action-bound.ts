import type { SimBattle, SimPokemon } from './types.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';
import { queuePlace, activated } from '../sim-ask/index.ts';
import type { FellMark, LoggedMove, PlayedBounds, PlayedTurn, SlotBound } from '../played.ts';

/**
 * The order rules of the simulator's queue that a log can prove: the stand-in of a `|cant|` body (`cant-stand-in.ts`) and the bound of a
 * body that fell before it acted (`ruledOutMoves`).
 */

/** One action the log shows: the simulator's priority of its move and the action speed of its body (null: the body is not on the field). */
export interface LoggedAction { priority: number; speed: number | null }

/**
 * Whether the first action is certainly ahead of the second: a higher priority bracket, or the same bracket and a higher speed (a tie
 * proves nothing; `bySpeed: false` compares brackets only).
 */
export const precedes = (first: LoggedAction, second: LoggedAction, bySpeed = true): boolean =>
  first.priority > second.priority ||
  (bySpeed && first.priority === second.priority && first.speed !== null && second.speed !== null && first.speed > second.speed);

/** Whether an action of this priority and speed is certainly first in the queue against the other. */
export const certainlyFirst = (priority: number, speed: number, other: LoggedAction, bySpeed = true): boolean =>
  precedes({ priority, speed }, other, bySpeed);

/** The mirror: an action of this priority and speed is certainly behind the other (a lower bracket, or the same bracket and a lower speed). */
export const certainlyBehind = (priority: number, speed: number, other: LoggedAction, bySpeed = true): boolean =>
  precedes(other, { priority, speed }, bySpeed);

/**
 * The queue's own priority and speed (`queuePlace`, dice answered by the turn's activation lines) of each logged move at the start of the
 * turn; a body off the field keeps the move's Dex priority and no speed.
 */
export function loggedActions(battle: SimBattle, moves: readonly LoggedMove[], turn: readonly string[]): LoggedAction[] {
  return moves.map(({ slot, move }) => {
    const body = battle.sides[sideIndex(slot.slice(0, 2) as 'p1' | 'p2')]?.active[slot.charCodeAt(2) - 'a'.charCodeAt(0)];
    if (!body) return { priority: battle.dex.moves.get(move).priority, speed: null };
    const order = queuePlace(battle, body, toId(move), activated(battle, body, turn));
    return { priority: order.priority, speed: order.speed };
  });
}

/**
 * The moves a body cannot have chosen when the log shows it fell before it acted: a move certainly ahead of an action before the fall would
 * have run first, and a chosen switch always runs first. The bound abstains when the log's order contradicts the queue (After You, Quash, a
 * speed that changed in the turn). The speed proof stands only while no line before the fall moved a speed (`FellMark.speedMoved`); the
 * bracket proof always.
 */
export function ruledOutMoves(battle: SimBattle, body: SimPokemon, mark: FellMark): SlotBound {
  const none: SlotBound = { moves: [], switchOut: false };
  const actions = loggedActions(battle, mark.before, mark.activations);
  if (actions.length === 0) return none;
  const bySpeed = !mark.speedMoved;
  const contradicted = actions.some((later, index) => actions.slice(0, index).some(earlier => precedes(later, earlier, bySpeed)));
  if (contradicted) return none;
  const chance = activated(battle, body, mark.activations);
  const out = new Set<string>();
  for (const { id } of body.moveSlots) {
    const { priority, speed } = queuePlace(battle, body, id, chance);
    if (actions.some(action => certainlyFirst(priority, speed, action, bySpeed))) out.add(id);
  }
  return { moves: [...out], switchOut: true };
}

/**
 * The bounds of a turn's fallen bodies on the battle of its start: per side and slot `ruledOutMoves` (null: the slot did not fall);
 * undefined when no body fell.
 */
export function playedBoundsOf(battle: SimBattle, fell: PlayedTurn['fell']): PlayedBounds | undefined {
  if (!fell) return undefined;
  const bounds: PlayedBounds = {};
  for (const side of ['p1', 'p2'] as const) {
    const marks = fell[side];
    if (!marks) continue;
    const slots = marks.map((mark, slot) => {
      const body = battle.sides[sideIndex(side)]?.active[slot];
      return mark && body ? ruledOutMoves(battle, body, mark) : null;
    });
    if (slots.some(bound => bound !== null)) bounds[side] = slots;
  }
  return bounds.p1 || bounds.p2 ? bounds : undefined;
}
