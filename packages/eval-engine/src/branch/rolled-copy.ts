import { faintStep, forcedTurnDice, playBlockOnCopy, protocolBenchOf } from '../dice/logged-block.ts';
import { dieKey, type ForcedDie } from '../dice/types.ts';
import { forkBattle } from '../forward/position.ts';
import { ALIGNMENT_SEEDS, extractProtocolEvents, type ProtocolEvents } from '../hax-alignment.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';
import { serializeLiveBattle } from '../serialize.ts';
import { forcedBlock } from './arrival-dice.ts';
import { hasForceSwitch } from './corrections.ts';
import { getMainChoice, parseTurnBlocks } from './protocol-choices.ts';
import type { SimBattle } from './types.ts';



/** The roll the report names: the winner's click whose accuracy die came out as a miss. */
export interface RollSelector {
  side: 'p1' | 'p2';
  move: string;
  /** Doubles: the species the click aimed at, and the attacker's slot (0 or 1); singles leaves both out. */
  target?: string;
  slot?: number;
}

export interface RolledCopyInput {
  position: string;
  replayLog: string;
  turn: number;
  /** The die to turn over (`dieKey`): a chance of the log's turn. Omitted: the control copy, the log's own turn. */
  flip?: string;
  /** The report's roll instead of a key: the copy finds the key itself, or gives none if the log has no such miss. */
  roll?: RollSelector;
}

export interface RolledCopy {
  serialized: string;
  flip?: string;
  /** The game's end in the copy as a score from p1's view (1, -1, or 0 for a tie); null while it goes on. */
  terminal: number | null;
  /** `turn`: the next turn starts. `request`: a replacement request is open. `ended`: the game ends in the copy. */
  stage: 'turn' | 'request' | 'ended';
  log: string[];
  events: ProtocolEvents;
}

function turnedOver(dice: readonly ForcedDie[], key: string): ForcedDie[] | null {
  const at = dice.findIndex(die => dieKey(die.name) === key);
  const result = at < 0 ? undefined : dice[at].result;
  if (!result || !('happens' in result)) return null;
  return dice.map((die, index) => (index === at ? { name: die.name, result: { happens: !result.happens } } : die));
}

function speciesAt(battle: SimBattle, slot: string): string | null {
  const body = battle.sides[sideIndex(slot.slice(0, 2) as 'p1' | 'p2')]?.active[slot.charCodeAt(2) - 97];
  return body ? body.species.name : null;
}

// A spread move that missed both targets gives the first miss, in the log's order.
function rolledKey(dice: readonly ForcedDie[], battle: SimBattle, roll: RollSelector): string | null {
  const found = dice.find(die => {
    const { name, result } = die;
    if (name.kind !== 'accuracy' || !('happens' in result) || result.happens) return false;
    if (!name.slot.startsWith(roll.side) || name.moveId !== toId(roll.move)) return false;
    if (roll.slot !== undefined && name.slot.charCodeAt(2) - 97 !== roll.slot) return false;
    if (roll.target === undefined) return true;
    const body = name.targetSlot ? speciesAt(battle, name.targetSlot) : null;
    return body !== null && toId(body) === toId(roll.target);
  });
  return found ? dieKey(found.name) : null;
}

function terminalScore(copy: SimBattle, winner: string | null): number {
  if (winner === null) return 0;
  return copy.sides[0].name === winner ? 1 : copy.sides[1].name === winner ? -1 : 0;
}

function standingOf(copy: SimBattle, written: string[]): Omit<RolledCopy, 'flip'> {
  const stage = copy.ended ? 'ended' : hasForceSwitch(copy, 0) || hasForceSwitch(copy, 1) ? 'request' : 'turn';
  const events = extractProtocolEvents([...written]);
  return {
    serialized: serializeLiveBattle(copy), stage, log: written, events,
    terminal: stage === 'ended' ? terminalScore(copy, events.winner) : null,
  };
}

/** Plays the logged turn with one die turned over; null when the log lacks the die or the turn cannot be played. */
export function rolledCopy({ position, replayLog, turn, flip: key, roll }: RolledCopyInput): RolledCopy | null {
  try {
    const seed = ALIGNMENT_SEEDS[0];
    const battle = forkBattle({ serialized: position }, seed) as SimBattle;
    if (battle.ended || battle.turn !== turn || battle.requestState !== 'move') return null;
    const log = normalizeLineEndings(replayLog);
    const block = parseTurnBlocks(log).turns.find(entry => entry.turn === turn);
    if (!block) return null;
    const choices = { p1: getMainChoice(block.preUpkeep, 'p1', battle), p2: getMainChoice(block.preUpkeep, 'p2', battle) };
    const lines = [...block.preUpkeep, ...block.postUpkeep];
    const aligned = forcedBlock(battle, block);
    const bench = protocolBenchOf(log, lines, turn);
    const { dice, seed: playSeed } = faintStep({
      battle, expected: aligned.expectedEvents, seed, choices, lines, forced: aligned.alignForced, bench,
    }, forcedTurnDice(battle, lines, choices));
    if (!dice) return null;
    const flip = roll ? rolledKey(dice, battle, roll) : key;
    if (flip === null) return null;
    const played = flip === undefined ? dice : turnedOver(dice, flip);
    if (!played) return null;
    const copy = forkBattle({ serialized: position }, playSeed);
    const start = copy.log.length;
    playBlockOnCopy({ copy, dice: played, choices, forced: aligned.alignForced, bench, stopAtRequest: true });
    return { ...standingOf(copy as SimBattle, copy.log.slice(start)), ...(flip !== undefined ? { flip } : {}) };
  } catch {
    return null;
  }
}
