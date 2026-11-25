import type { BranchSlotChoice, DieOffer, ForcedDie, LiveHit, ResolvedSideCommand } from '@fulllifegames/eval-engine';

// The engine's offers read the live battle on copies and never write it.

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
  required: { p1: boolean[]; p2: boolean[] };
  turnReady: boolean;
  /** The replay's log for a stored position viewed before a branch starts; else the first-turn PRNG names the dice. */
  replayLog?: string;
}

export interface DiceOffers {
  /** The dice of each slot's chosen move, by the sim's slot name ("p1a"). */
  bySlot: Record<string, DieOffer[]>;
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

/** The dice the panel offers for the position; a move the engine cannot read leaves its part empty. */
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
