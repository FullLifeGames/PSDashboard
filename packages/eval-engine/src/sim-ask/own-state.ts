import type { Battle, Pokemon } from '@pkmn/sim';
import { guarded } from './guard.ts';
import { callHandler } from './handler.ts';
import { bodyInView, isolated } from './isolated.ts';

type Dex = Battle['dex'];
type TryHandler = (this: never, ...args: never[]) => unknown;
interface BodyTry { handler: TryHandler | null; firstTurn: boolean }

const READS_ACTIONS = /\bactiveMoveActions\b/;
const tries = new WeakMap<Dex, Map<string, BodyTry>>();

function bodyTry(dex: Dex, moveId: string): BodyTry {
  let byId = tries.get(dex);
  if (!byId) tries.set(dex, byId = new Map());
  let found = byId.get(moveId);
  if (!found) {
    const move = dex.moves.get(moveId) as { onTry?: unknown };
    const handler = typeof move.onTry === 'function' ? move.onTry as TryHandler : null;
    const firstTurn = handler !== null && READS_ACTIONS.test(String(handler));
    byId.set(moveId, found = { handler: firstTurn ? handler : null, firstTurn });
  }
  return found;
}

/** Whether the move's own Try handler reads the body's action count: a move for the first turn out only. */
export function firstTurnOnly(dex: Dex, moveId: string): boolean {
  return bodyTry(dex, moveId).firstTurn;
}

/** Whether the move's own Try handler refuses `source` now: a first-turn move after an action. */
export function refusedByBody(battle: Battle, source: Pokemon, target: Pokemon, moveId: string): boolean {
  const { handler } = bodyTry(battle.dex, moveId);
  if (!handler) return false;
  const view = isolated(battle);
  return guarded(battle, [], () => {
    const body = bodyInView(view, source);
    // `runMove` raises the count before the Try event, and no action is queued yet when a choice is made.
    body.activeMoveActions += 1;
    view.queue = { willAct: () => true } as never;
    const answer = callHandler(handler, view, [body, bodyInView(view, target), battle.dex.getActiveMove(moveId)]);
    return answer.ok && (answer.value === false || answer.value === null);
  });
}
