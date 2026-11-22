import type { BranchSlotChoice, DieOffer, ForcedDie, LiveHit, ResolvedSideCommand } from '@fulllifegames/eval-engine';

/**
 * Round 82 (forced dice), step A7a: what the panel asks the engine about the position it shows. The engine's offers read the live
 * battle on copies and never write it (`offeredDice` for one slot's chosen move, `offeredOrderDice` and `offeredEndDice` for the
 * turn once both sides have chosen). The engine arrives through the lazy chunk, so the caller hands it in.
 */

type Battle = LiveHit['battle'];
type Choices = readonly (BranchSlotChoice | null)[];

interface Engine {
  offeredDice(battle: Battle, slot: string, choice: BranchSlotChoice): DieOffer[];
  offeredOrderDice(battle: Battle, play: (battle: Battle) => void): DieOffer[];
  offeredEndDice(battle: Battle, play: (battle: Battle) => void): DieOffer[];
  loggedTurnDice(battle: Battle): ForcedDie[];
  loggedDiceAt(battle: Battle, replayLog: string): ForcedDie[];
  resolveSideChoices(battle: Battle, side: 'p1' | 'p2', choices: (BranchSlotChoice | null)[], required: boolean[]): ResolvedSideCommand;
}

export interface DiceAsk {
  battle: Battle;
  choices: { p1: Choices; p2: Choices };
  /** The slots that must act this turn, per side. */
  required: { p1: boolean[]; p2: boolean[] };
  /** Both sides have chosen every required slot: the turn's own dice (order, end of turn) can be read. */
  turnReady: boolean;
  /**
   * The replay's log, for a stored position the user views before a branch starts there (round 82, step A7b): the log's dice come from
   * its lines. Without it the battle's own first-turn PRNG names them (a branch's live battle).
   */
  replayLog?: string;
}

export interface DiceOffers {
  /** The dice of each slot's chosen move, by the sim's slot name ("p1a"). */
  bySlot: Record<string, DieOffer[]>;
  /** The dice of the turn: speed ties, first movers, the end of the turn. */
  turn: DieOffer[];
  /** What the log shows for the first turn of a branch, by die; empty on later turns. */
  logged: ForcedDie[];
}

const slotName = (side: 'p1' | 'p2', index: number): string => `${side}${String.fromCharCode(97 + index)}`;

function slotOffers(engine: Engine, ask: DiceAsk): Record<string, DieOffer[]> {
  const offers: Record<string, DieOffer[]> = {};
  for (const side of ['p1', 'p2'] as const) {
    ask.choices[side].forEach((choice, index) => {
      if (choice?.kind !== 'move' || !ask.required[side][index]) return;
      offers[slotName(side, index)] = engine.offeredDice(ask.battle, slotName(side, index), choice);
    });
  }
  return offers;
}

/** The turn's commands on a copy, the way the live battle gets them; a refused click ends the play. */
function turnPlay(engine: Engine, ask: DiceAsk): ((battle: Battle) => void) | null {
  const commands: { side: 'p1' | 'p2'; command: string }[] = [];
  for (const side of ['p1', 'p2'] as const) {
    const resolved = engine.resolveSideChoices(ask.battle, side, [...ask.choices[side]], ask.required[side]);
    if (!resolved.ok) return null;
    commands.push({ side, command: resolved.command });
  }
  return battle => {
    for (const { side, command } of commands) {
      if (!battle.choose(side, command)) throw new Error(`The simulator refused "${command}" for ${side}.`);
    }
  };
}

/**
 * The dice the panel offers for the position. A failure of the engine to read a move leaves that part empty: the panel
 * shows what it can, and Execute stays as it was.
 */
export function askDice(engine: Engine, ask: DiceAsk): DiceOffers {
  let bySlot: Record<string, DieOffer[]> = {};
  let turn: DieOffer[] = [];
  let logged: ForcedDie[] = [];
  try {
    bySlot = slotOffers(engine, ask);
    logged = ask.replayLog ? engine.loggedDiceAt(ask.battle, ask.replayLog) : engine.loggedTurnDice(ask.battle);
    const play = ask.turnReady ? turnPlay(engine, ask) : null;
    if (play) turn = [...engine.offeredOrderDice(ask.battle, play), ...engine.offeredEndDice(ask.battle, play)];
  } catch {
    // an unreadable position offers what was read so far
  }
  return { bySlot, turn, logged };
}
