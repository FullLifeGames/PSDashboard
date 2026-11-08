import type { SimBattle, SimPokemon } from './types.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * Round 88 (X2): the stand-in of a body whose turn shows a `|cant|` line. The log's order puts the line before the actions that
 * follow it, and the slowest move (the default stand-in of `protocol-choices.ts`) can push the body behind one of them.
 */

/** One action the log shows: the Dex priority of its move and the action speed of its body (null: the body is not on the field). */
interface LoggedAction { priority: number; speed: number | null }

/**
 * The move actions in a stretch of a turn's lines, other than the slot's own: a `|move|` line is an action unless a `[from]`
 * tag says another effect ran it (a Dancer copy, a Magic Bounce reflection, Sleep Talk's inner move); a locked move still is one.
 * The priority is the Dex's own and the speed the simulator's `getActionSpeed` at the start of the turn.
 */
function loggedActions(battle: SimBattle, lines: string[], ownIdent: string): LoggedAction[] {
  const out: LoggedAction[] = [];
  for (const line of lines) {
    const parts = line.split('|');
    const mover = /^(p[12])([a-d]):/.exec(parts[2] ?? '');
    if (parts[1] !== 'move' || !mover || `${mover[1]}${mover[2]}:` === ownIdent) continue;
    if (parts.slice(5).some(tag => tag.startsWith('[from]') && !tag.startsWith('[from]lockedmove'))) continue;
    const body = battle.sides[sideIndex(mover[1] as 'p1' | 'p2')]?.active[mover[2].charCodeAt(0) - 'a'.charCodeAt(0)];
    out.push({ priority: battle.dex.moves.get(parts[3]).priority, speed: body ? body.getActionSpeed() : null });
  }
  return out;
}

/** Whether an action of this priority and speed is certainly first in the queue: a higher bracket, or the same bracket and a higher speed. */
const certainlyFirst = (priority: number, speed: number, other: LoggedAction): boolean =>
  priority > other.priority || (priority === other.priority && other.speed !== null && speed > other.speed);

/** The mirror: an action of this priority and speed is certainly behind the other (a lower bracket, or the same bracket and a lower speed). */
const certainlyBehind = (priority: number, speed: number, other: LoggedAction): boolean =>
  priority < other.priority || (priority === other.priority && other.speed !== null && speed < other.speed);

/**
 * Round 88 (X2): the stand-in of a body whose turn shows a `|cant|` line and an action after it: the lowest-priority enabled move
 * (the first of a tie, as `slowestRequestMove`) that keeps the body's place, ahead of every action the log shows after the line
 * and behind every one before it. The order is the simulator's: the move's Dex priority, then `getActionSpeed` (Trick Room,
 * Tailwind, paralysis, a Scarf inside it), a tie of speed counting as no proof. Null: no cant line, no action after it, or no move
 * that keeps both sides, and the slowest move stays the choice.
 */
export function cantStandIn(battle: SimBattle, active: SimPokemon | null | undefined, events: string[], ident: string): string | null {
  if (!active || !ident) return null;
  const cantAt = events.findIndex(line => line.startsWith(`|cant|${ident}`));
  if (cantAt < 0) return null;
  const after = loggedActions(battle, events.slice(cantAt + 1), ident);
  if (after.length === 0) return null;
  const before = loggedActions(battle, events.slice(0, cantAt), ident);
  const speed = active.getActionSpeed();
  let standIn: { id: string; priority: number } | null = null;
  for (const entry of active.getMoveRequestData().moves) {
    if (entry.disabled) continue;
    const priority = battle.dex.moves.get(entry.id).priority;
    if (standIn && priority >= standIn.priority) continue;
    if (!after.every(action => certainlyFirst(priority, speed, action))) continue;
    if (!before.every(action => certainlyBehind(priority, speed, action))) continue;
    standIn = { id: entry.id, priority };
  }
  return standIn?.id ?? null;
}
