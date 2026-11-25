import type { SimBattle, SimPokemon } from './types.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';
import { queuePlace, activated } from '../sim-ask/index.ts';
import type { FellMark, LoggedMove, PlayedBounds, PlayedTurn, SlotBound } from '../played.ts';


/** One action the log shows: its move's priority and its body's action speed (null: the body is off the field). */
export interface LoggedAction { priority: number; speed: number | null }

/** Whether the first action is certainly ahead of the second: a higher bracket, or the same one and a higher speed. */
export const precedes = (first: LoggedAction, second: LoggedAction, bySpeed = true): boolean =>
  first.priority > second.priority ||
  (bySpeed && first.priority === second.priority && first.speed !== null && second.speed !== null && first.speed > second.speed);

export const certainlyFirst = (priority: number, speed: number, other: LoggedAction, bySpeed = true): boolean =>
  precedes({ priority, speed }, other, bySpeed);

export const certainlyBehind = (priority: number, speed: number, other: LoggedAction, bySpeed = true): boolean =>
  precedes(other, { priority, speed }, bySpeed);

/** Each logged move's queue priority and speed (`queuePlace`) at the turn's start; off the field: Dex priority. */
export function loggedActions(battle: SimBattle, moves: readonly LoggedMove[], turn: readonly string[]): LoggedAction[] {
  return moves.map(({ slot, move }) => {
    const body = battle.sides[sideIndex(slot.slice(0, 2) as 'p1' | 'p2')]?.active[slot.charCodeAt(2) - 'a'.charCodeAt(0)];
    if (!body) return { priority: battle.dex.moves.get(move).priority, speed: null };
    const order = queuePlace(battle, body, toId(move), activated(battle, body, turn));
    return { priority: order.priority, speed: order.speed };
  });
}

/** The moves a body cannot have chosen when the log shows it fell before it acted. */
// Abstains when the log contradicts the queue (After You, Quash, a speed change); the speed proof needs !`speedMoved`.
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
