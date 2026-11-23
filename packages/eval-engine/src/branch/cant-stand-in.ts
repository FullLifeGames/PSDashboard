import type { SimBattle, SimPokemon } from './types.ts';
import { queuePlace, activated } from '../sim-ask/index.ts';
import { certainlyBehind, certainlyFirst, loggedActions, type LoggedAction } from './action-bound.ts';
import { loggedMoves } from '../played.ts';

/** The move actions in a stretch of a turn's lines other than the slot's own (`loggedMoves` skips a `[from]` line: another effect ran it), with the simulator's place of each. */
const actionsIn = (battle: SimBattle, lines: string[], ownIdent: string, turn: string[]): LoggedAction[] =>
  loggedActions(battle, loggedMoves(lines).filter(({ slot }) => `${slot}:` !== ownIdent), turn);

/**
 * The stand-in move of a body whose turn shows a `|cant|` line and an action after it: the log puts the line before the later actions, and the slowest move
 * (`protocol-choices.ts`' default) can push the body behind one of them. It is the lowest-priority enabled move (the first of a tie, as `slowestRequestMove`) that
 * stands ahead of every action after the line and behind every one before it, by the simulator's order (`queuePlace`; a tie of speed is no proof).
 * Null when there is no cant line, no action after it, or no move that keeps both sides: the slowest move stays.
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
