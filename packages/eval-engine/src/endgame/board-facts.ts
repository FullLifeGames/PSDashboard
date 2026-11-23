import { State, type Battle } from '@pkmn/sim';

/**
 * The board facts: what two draws of one cell may differ by without being two boards. A position's facts are its serialized state
 * (the memo key's, `endgame/key.ts`) without the STRIPPED_FIELDS, the ROLL_FIELDS, the turn's bookkeeping and the nominal aim.
 * `board-facts.spec.ts` holds each drop against the simulator: a scan of the installed builds pins every read of a dropped key.
 */

/**
 * The fields of a serialized position that follow the damage a roll dealt, never the class: HP, last damage, damage taken and the
 * totals of a move line; they sit at several depths, so the drop is deep. `moveHitData` holds the crit the roll drew on the finished
 * move at three places; a crit sits outside the class model (the proof answers "barring a crit"), and the simulator reads the record only
 * inside the move that made it (every `getMoveHitData(move)` of @pkmn/sim and @pkmn/mods passes the move in progress;
 * `prover-helping-secondary-sweep.spec.ts` holds that).
 */
export const ROLL_FIELDS: ReadonlySet<string> = new Set(['hp', 'lastDamage', 'hurtThisTurn', 'damage', 'damageValue', 'totalDamage', 'moveHitData']);

/** What the memo key drops (logs, dice, turn and effect-order counters), and the start-of-turn roll of Gens 2 and 3 (the dice of the next turn). */
export const STRIPPED_FIELDS = ['log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine', 'hints', 'effectOrder', 'quickClawRoll'] as const;

/**
 * The bookkeeping of a turn: per body the stages raised and lowered this turn and the move used this turn, on the battle the last
 * successful move. The simulator resets all four in `Battle.endTurn` and every read is a handler of the turn (Burning Jealousy, Lash
 * Out, Fusion Flare, the Gen 1 and 2 "already moved" test). Exception: `endTurn` skips the reset of the two stage flags before turn 1
 * (stages the leads' abilities raised count as raised this turn), so the facts keep the flags while `battle.turn` is 1 or less.
 */
export const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set(['statsRaisedThisTurn', 'statsLoweredThisTurn', 'moveThisTurn']);
export const BOOKKEEPING_FIELDS = ['lastSuccessfulMoveThisTurn'] as const;
const FLAGS_OF_TURN_ONE = new Set(['statsRaisedThisTurn', 'statsLoweredThisTurn']);

/**
 * The nominal aim of a body's last move (`lastMoveTargetLoc`): the slot the click named or, for a move that takes no chosen target, the
 * slot the simulator drew; the move ignores it, yet two draws of one turn differ by it. Instruct and a locked or charging body read it
 * again later only for a move that takes a chosen target (`targetTypeChoices`), so the aim stays a fact for those and drops for the rest,
 * and for a fainted body that lost its last move.
 */
export const AIM_KEY = 'lastMoveTargetLoc';

type Json = Record<string, unknown>;
interface Bodies { pokemon: Json[] }

/** The serialized position without the stripped fields (the memo key's reading of a board). */
function state(battle: Battle): Json & { sides: Bodies[] } {
  const serialized = State.serializeBattle(battle) as unknown as Json & { sides: Bodies[] };
  for (const field of STRIPPED_FIELDS) delete serialized[field];
  return serialized;
}

export interface StageReading { rest: string; boosts: Record<string, number>[][] }

/** The position with the roll fields and the stat stages taken out: the rest as one string, the stages by side and body; the turn's bookkeeping stays in `rest`. */
export function stageReading(battle: Battle): StageReading {
  const serialized = state(battle);
  const boosts = serialized.sides.map(side => side.pokemon.map(body => {
    const own = (body.boosts ?? {}) as Record<string, number>;
    delete body.boosts;
    return own;
  }));
  return { rest: JSON.stringify(serialized, (key, value: unknown) => (ROLL_FIELDS.has(key) ? undefined : value)), boosts };
}

/** The board facts of a position as one string: two draws with equal facts are the same board for everything the next turns read. */
export function boardFacts(battle: Battle): string {
  // A finished battle has no later turn; the actions the game did not reach stay in the queue, and the prover reads only the winner
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
