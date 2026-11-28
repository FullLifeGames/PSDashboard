import type { Battle, Pokemon } from '@pkmn/sim';
import { hazardConditions } from '@fulllifegames/replay-core';
import { isPivotMove } from './pivot-moves.ts';
import { queuePlace } from './sim-ask/index.ts';

/** The body a hit lands on; `incoming` while it waits on the bench for the turn's switch. */
export interface EventDefender {
  body: Pokemon;
  incoming: boolean;
}

export function moveIdOf(choice: string): string | null {
  const head = choice.split(' > ')[0].trim();
  const tokens = head.split(/\s+/);
  return tokens[0] === 'move' && tokens[1] ? tokens[1] : null;
}

function incomingBody(battle: Battle, oppIndex: 0 | 1, bench: string): EventDefender | null {
  const oppSide = battle.sides[oppIndex];
  if (Object.keys(oppSide.sideConditions ?? {}).some(id => hazardConditions(battle.dex).has(id))) return null;
  const body = oppSide.pokemon[Number(bench) - 1];
  return !body || body.fainted ? null : { body, incoming: true };
}

function acts(battle: Battle, first: [Pokemon, string], second: [Pokemon, string], chance: boolean): boolean | null {
  const [one, other] = [queuePlace(battle, first[0], first[1], chance), queuePlace(battle, second[0], second[1], chance)];
  if (one.priority !== other.priority) return one.priority > other.priority;
  return one.speed === other.speed ? null : one.speed > other.speed;
}

function pivotDefender(battle: Battle, oppIndex: 0 | 1, attack: [Pokemon, string], oppChoice: string): EventDefender | null {
  const [head, follow] = oppChoice.split(' > ');
  const pivotId = moveIdOf(head);
  const bench = /^switch\s+(\d+)$/.exec(follow.trim())?.[1];
  const user = battle.sides[oppIndex].active[0];
  if (!pivotId || !bench || !user || user.fainted || !isPivotMove(battle.dex, pivotId)) return null;
  const order = [false, true].map(chance => acts(battle, attack, [user, pivotId], chance));
  if (order[0] === null || order[0] !== order[1]) return null;
  if (order[0]) return { body: user, incoming: false };
  // Baton Pass and Shed Tail hand state to the next body, which the plan does not read.
  return battle.dex.moves.get(pivotId).selfSwitch === true ? incomingBody(battle, oppIndex, bench) : null;
}

export function eventDefender(battle: Battle, oppIndex: 0 | 1, oppChoice: string, attack: [Pokemon, string]): EventDefender | null {
  const switchMatch = /^switch\s+(\d+)/.exec(oppChoice.trim());
  if (switchMatch) return incomingBody(battle, oppIndex, switchMatch[1]);
  if (oppChoice.includes(' > ')) return pivotDefender(battle, oppIndex, attack, oppChoice);
  const active = battle.sides[oppIndex].active[0];
  return !active || active.fainted ? null : { body: active, incoming: false };
}
