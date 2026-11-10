import type { SimBattle, SimPokemon } from './types.ts';
import { queuePlace, activated } from '../sim-ask/index.ts';
import { certainlyBehind, certainlyFirst, loggedActions, type LoggedAction } from './action-bound.ts';
import { loggedMoves } from '../played.ts';

/**
 * Round 88 (X2): the stand-in of a body whose turn shows a `|cant|` line. The log's order puts the line before the actions that
 * follow it, and the slowest move (the default stand-in of `protocol-choices.ts`) can push the body behind one of them.
 */

/**
 * The move actions in a stretch of a turn's lines, other than the slot's own (`loggedMoves` reads them: a `[from]` tag says another effect ran
 * a `|move|` line), with the simulator's place of each (`loggedActions`).
 */
const actionsIn = (battle: SimBattle, lines: string[], ownIdent: string, turn: string[]): LoggedAction[] =>
  loggedActions(battle, loggedMoves(lines).filter(({ slot }) => `${slot}:` !== ownIdent), turn);

/**
 * Round 88 (X2): the stand-in of a body whose turn shows a `|cant|` line and an action after it: the lowest-priority enabled move
 * (the first of a tie, as `slowestRequestMove`) that keeps the body's place, ahead of every action the log shows after the line
 * and behind every one before it. The order is the simulator's: the action's priority and speed from `queuePlace` (round 89, #111: the
 * queue's own priority with the body's ability, item and move handlers, then `getActionSpeed` with Trick Room, Tailwind, paralysis,
 * a Scarf), a tie of speed counting as no proof. Null: no cant line, no action after it, or no move
 * that keeps both sides, and the slowest move stays the choice.
 */
export function cantStandIn(battle: SimBattle, active: SimPokemon | null | undefined, events: string[], ident: string): string | null {
  if (!active || !ident) return null;
  const cantAt = events.findIndex(line => line.startsWith(`|cant|${ident}`));
  if (cantAt < 0) return null;
  const after = actionsIn(battle, events.slice(cantAt + 1), ident, events);
  if (after.length === 0) return null;
  const before = actionsIn(battle, events.slice(0, cantAt), ident, events);
  const chance = activated(battle, active, events);
  let standIn: { id: string; priority: number } | null = null;
  for (const entry of active.getMoveRequestData().moves) {
    if (entry.disabled) continue;
    const { priority, speed } = queuePlace(battle, active, entry.id, chance);
    if (standIn && priority >= standIn.priority) continue;
    if (!after.every(action => certainlyFirst(priority, speed, action))) continue;
    if (!before.every(action => certainlyBehind(priority, speed, action))) continue;
    standIn = { id: entry.id, priority };
  }
  return standIn?.id ?? null;
}
