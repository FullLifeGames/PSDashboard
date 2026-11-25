import { State, type Battle } from '@pkmn/sim';

// Board facts: what two draws of one cell may differ by without being two boards; board-facts.spec.ts holds each drop.

// `moveHitData` (the crit) drops: the simulator reads it only inside its move (prover-helping-secondary-sweep.spec.ts).
export const ROLL_FIELDS: ReadonlySet<string> = new Set(['hp', 'lastDamage', 'hurtThisTurn', 'damage', 'damageValue', 'totalDamage', 'moveHitData']);

export const STRIPPED_FIELDS = ['log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine', 'hints', 'effectOrder', 'quickClawRoll'] as const;

// Reset in `Battle.endTurn` and read by handlers of the turn; `endTurn` skips the two stage flags before turn 1,
// so the facts keep them while `battle.turn` is 1 or less.
export const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set(['statsRaisedThisTurn', 'statsLoweredThisTurn', 'moveThisTurn']);
export const BOOKKEEPING_FIELDS = ['lastSuccessfulMoveThisTurn'] as const;
const FLAGS_OF_TURN_ONE = new Set(['statsRaisedThisTurn', 'statsLoweredThisTurn']);

// The move ignores its nominal aim, yet two draws differ by it; Instruct and a locked or charging body read it again
// only for a move that takes a chosen target (`targetTypeChoices`): a fact for those, dropped for the rest.
export const AIM_KEY = 'lastMoveTargetLoc';

type Json = Record<string, unknown>;

/** Replaces each absolute landing turn a condition stores (`endingTurn`) by the turns left. */
export function rebaseClocks(node: unknown, battle: Battle): void {
  if (!node || typeof node !== 'object') return;
  const turns = battle.getOverflowedTurnCount();
  for (const [key, child] of Object.entries(node)) {
    if (key === 'endingTurn' && typeof child === 'number') (node as Json)[key] = child - turns;
    else rebaseClocks(child, battle);
  }
}
interface Bodies { pokemon: Json[] }

function state(battle: Battle): Json & { sides: Bodies[] } {
  const serialized = State.serializeBattle(battle) as unknown as Json & { sides: Bodies[] };
  for (const field of STRIPPED_FIELDS) delete serialized[field];
  return serialized;
}

export interface StageReading { rest: string; boosts: Record<string, number>[][] }

export function stageReading(battle: Battle): StageReading {
  const serialized = state(battle);
  const boosts = serialized.sides.map(side => side.pokemon.map(body => {
    const own = (body.boosts ?? {}) as Record<string, number>;
    delete body.boosts;
    return own;
  }));
  return { rest: JSON.stringify(serialized, (key, value: unknown) => (ROLL_FIELDS.has(key) ? undefined : value)), boosts };
}

/** The board facts as one string: equal facts are the same board for everything the next turns read. */
export function boardFacts(battle: Battle): string {
  // A finished battle has no later turn: unreached actions stay in the queue, and the prover reads only the winner.
  if (battle.ended) return `ended|${battle.winner}`;
  const serialized = state(battle);
  for (const field of BOOKKEEPING_FIELDS) delete serialized[field];
  const keepFlags = battle.turn <= 1;
  serialized.sides.forEach((side, sideIndex) => side.pokemon.forEach((body, bodyIndex) => {
    for (const key of BOOKKEEPING_KEYS) if (keepFlags ? !FLAGS_OF_TURN_ONE.has(key) : true) delete body[key];
    const live = battle.sides[sideIndex].pokemon[bodyIndex];
    if (live.lastMove ? !battle.actions.targetTypeChoices(live.lastMove.target) : live.fainted) delete body[AIM_KEY];
  }));
  return JSON.stringify(serialized, (key, value: unknown) => (ROLL_FIELDS.has(key) ? undefined : value));
}
