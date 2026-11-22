import type { SimBattle, SimPokemon } from './types.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';
import { queuePlace, activated } from '../sim-ask/index.ts';
import type { FellMark, LoggedMove, PlayedBounds, PlayedTurn, SlotBound } from '../played.ts';

/**
 * Round 89 (#108, #111): the order rules of the simulator's queue that a log can prove. One module for the stand-in of a body whose
 * turn shows a `|cant|` line (`cant-stand-in.ts`) and for the bound of a body that fell before it acted (`ruledOutMoves`, read by
 * the grading).
 */

/** One action the log shows: the simulator's priority of its move and the action speed of its body (null: the body is not on the field). */
export interface LoggedAction { priority: number; speed: number | null }

/**
 * Whether the first action is certainly ahead of the second in the queue: a higher priority bracket, or the same bracket and a
 * higher speed. A tie of speed is no proof, and `bySpeed: false` leaves only the bracket (a line of the turn moved a speed).
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
 * The simulator's place of each logged move action: the priority and the speed are the queue's own for that body at the start of the
 * turn (`queuePlace`: Prankster, Gale Wings, Triage, Grassy Glide, Stall, Lagging Tail, Quick Claw and the other handlers), the dice
 * answering by the activation lines of the whole turn (`activated`); a body that is not on the field keeps the move's Dex priority
 * and no speed.
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
 * Round 89 (#108): the moves a body cannot have chosen when the log shows it fell before it acted. The queue runs the actions in
 * order, so a move that stands certainly ahead of one of the actions before the fall would have run first; a tie proves nothing. A
 * chosen switch always runs first, so it is out too. Nothing is out when no action precedes the fall, and nothing when the log's own
 * order contradicts the queue (an action the queue puts ahead of an earlier one: After You, Quash, a speed that changed in the turn):
 * then the start-of-turn order is no proof and the bound abstains. The speed proof stands only while no line before the fall moved a
 * speed (`FellMark.speedMoved`); the bracket proof always.
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
 * Round 89 (#108): the bounds of a turn's fallen bodies on the battle of the turn's start: per side and slot, `ruledOutMoves` of the body
 * in that slot (null: the slot did not fall, or no body stands there). Undefined when no body fell. The search's root reads it once per
 * position and ships it with the result (`EvalResult.playedBounds`), the way it ships the kill odds and the unanswered profile.
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
