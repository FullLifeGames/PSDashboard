import { State, type Battle } from '@pkmn/sim';

/**
 * Round 89 (#145, step A6-0): the board facts, one module for what two draws of one cell may differ by without being two boards.
 * Round 88 (T336) wrote the first half in `prover-helping.ts` (the roll fields and the stripped fields of its reading); A6 reads the
 * same lists to ask of a plain cell which chance dice moved the board, so both import them from here.
 *
 * The facts of a position are its serialized state (the memo key's, `endgame/key.ts`) without
 *  - the STRIPPED_FIELDS: logs, the dice, the turn counter and the effect-order counter, and the start-of-turn roll of Gens 2 and 3
 *    (the dice of the next turn, drawn from the stream);
 *  - the ROLL_FIELDS: what the damage roll, the critical hit and the hit count decide. The prover answers "on the sampled rolls";
 *  - the turn's bookkeeping: what the simulator writes during a turn and resets at its end (BOOKKEEPING_KEYS and BOOKKEEPING_FIELDS),
 *    and the nominal aim of a move that takes no chosen target (AIM_KEY).
 * `board-facts.spec.ts` holds each drop against the simulator: a scan of the installed builds pins every read of a dropped key.
 */

/**
 * The fields of a serialized position that follow the damage a roll dealt, never the class (the classes already average over rolls):
 * the HP, the last damage, the damage a body took and the totals a move line keeps. They sit at several depths, so the drop is deep.
 * Round 89 (#148): `moveHitData` joins them. It holds the critical hit the roll drew (and the type modifier and the Protect bypass of
 * that one hit) on the finished move at three places (`battle.lastMove`, the user's `lastMove` and `lastMoveUsed`). A crit is a fact
 * of the roll like the damage and sits outside the class model (`prover.ts`: the proof answers "barring a crit"); when one of the
 * two drawn children crit and the other did not, the rule saw a difference and kept the classes apart. The simulator reads the
 * record only inside the move that made it (every `getMoveHitData(move)` of @pkmn/sim and @pkmn/mods passes the move in progress;
 * `prover-helping-secondary-sweep.spec.ts` holds that), so nothing a later turn does depends on it.
 */
export const ROLL_FIELDS: ReadonlySet<string> = new Set(['hp', 'lastDamage', 'hurtThisTurn', 'damage', 'damageValue', 'totalDamage', 'moveHitData']);

/** What the memo key drops (endgame/key.ts), and the start-of-turn roll of Gens 2 and 3 (the dice of the next turn, drawn from the stream). */
export const STRIPPED_FIELDS = ['log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine', 'hints', 'effectOrder', 'quickClawRoll'] as const;

/**
 * The bookkeeping of a turn: per body the flags of the stages raised and lowered this turn and the move used this turn, and on the
 * battle the last successful move of the turn. The simulator writes them while the turn runs and resets all four in `Battle.endTurn`;
 * every read is a handler of the turn (Burning Jealousy, Lash Out, Fusion Flare, the Gen 1 and 2 "already moved" test). The one
 * exception is the first turn: `endTurn` skips the reset of the two stage flags before turn 1 (the stages the leads' abilities raised
 * at the start of the battle count as raised this turn), so the facts keep the flags while `battle.turn` is 1 or less.
 */
export const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set(['statsRaisedThisTurn', 'statsLoweredThisTurn', 'moveThisTurn']);
export const BOOKKEEPING_FIELDS = ['lastSuccessfulMoveThisTurn'] as const;
const FLAGS_OF_TURN_ONE = new Set(['statsRaisedThisTurn', 'statsLoweredThisTurn']);

/**
 * The nominal aim of a body's last move (`lastMoveTargetLoc`): the slot the click named or, when the move takes no chosen target (a
 * spread move, a move on the user or a side), the slot the simulator drew for it. The dice draw that slot, the move ignores it, and
 * two draws of one turn differ by it (160 of 326 plain cells of the saved set of A6's probe). Instruct and a locked or charging body
 * read it again in a later turn, but only for a move that takes a chosen target (`targetTypeChoices` of the simulator, read from the
 * move's Dex entry), so the aim stays a fact for those and drops for the rest. A fainted body that lost its last move (a move that takes the user down) keeps no aim either.
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

/**
 * The position with the roll fields and the stat stages taken out: the rest as one string, the stages by side and body. The helping
 * rule of round 88 (`prover-helping.ts`) compares two of these; it keeps the turn's bookkeeping in `rest`, as it always did.
 */
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
  // Round 89 (A6-2): a finished battle has no later turn; the actions the game did not reach stay in the queue, and the prover reads only the winner (`prove`)
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
