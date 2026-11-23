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

/** The copy of a logged turn with one die turned over (a Fire Fang that missed hits, a Gunk Shot that hit misses), for the report's biggest roll. */

// The copy plays the turn as the reconstruction does (the log's choices, seed index 0, every die the log shows forced, `faintStep`), turns
// the one die over before the play, and stops where the turn opens a replacement request, the next root. The faint step searches the
// damage rolls that make the log's faints, so it runs on the log's turn; the turned die plays on top of its result and the faints may
// differ. A die the log does not show gives no copy. The hit's own damage roll, crit and secondary are no die of the log (it shows a
// miss), so they fall to the hidden dice of the seed. No snapshot corrects the copy's position.

/** The roll the report names: the winner's click whose accuracy die came out as a miss. */
export interface RollSelector {
  side: 'p1' | 'p2';
  /** The move's name as the report prints it. */
  move: string;
  /** Doubles: the species of the body the click aimed at, and the slot index (0 or 1) of the attacker. Singles leaves both out. */
  target?: string;
  slot?: number;
}

/** The input of `rolledCopy`: the turn's start position, the log, and the die to turn over by key or by the report's roll. */
export interface RolledCopyInput {
  /** The serialized position at the start of `turn` (the sweep's boundary position). */
  position: string;
  replayLog: string;
  turn: number;
  /** The die to turn over (`dieKey`): a chance of the log's turn. Omitted: the control copy, the log's own turn. */
  flip?: string;
  /** The roll the report names, instead of a key: the copy finds the key itself, or gives no copy where the log has no such miss. */
  roll?: RollSelector;
}

/** The position after the copy's turn with the die turned over, and how the turn ended. */
export interface RolledCopy {
  /** The position of the next root. */
  serialized: string;
  /** The key of the die the copy turned over (absent on the control copy). */
  flip?: string;
  /** The end of the game in the copy, as a score from p1's view (1, -1, or 0 for a tie); null while the game goes on. */
  terminal: number | null;
  /** `turn`: the start of the next turn. `request`: a replacement request is open. `ended`: the game ends in the copy. */
  stage: 'turn' | 'request' | 'ended';
  /** The lines the copy wrote for the turn. */
  log: string[];
  events: ProtocolEvents;
}

/** The list with the die of that key turned over; null where the list has no such die or it is no chance. */
function turnedOver(dice: readonly ForcedDie[], key: string): ForcedDie[] | null {
  const at = dice.findIndex(die => dieKey(die.name) === key);
  const result = at < 0 ? undefined : dice[at].result;
  if (!result || !('happens' in result)) return null;
  return dice.map((die, index) => (index === at ? { name: die.name, result: { happens: !result.happens } } : die));
}

/** The species of the body at a slot of the turn's start position ('p2a'), or null. */
function speciesAt(battle: SimBattle, slot: string): string | null {
  const body = battle.sides[sideIndex(slot.slice(0, 2) as 'p1' | 'p2')]?.active[slot.charCodeAt(2) - 97];
  return body ? body.species.name : null;
}

/**
 * The key of the miss the report named: an accuracy die with `happens: false` of that side and move, on the body the click aimed at and
 * from the slot the odds name. More than one such die (a spread move that missed both targets) gives the first, in the log's order.
 */
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

/** The score of a finished game from p1's view: the side whose name the win line carries. */
function terminalScore(copy: SimBattle, winner: string | null): number {
  if (winner === null) return 0;
  return copy.sides[0].name === winner ? 1 : copy.sides[1].name === winner ? -1 : 0;
}

/** Where the copy stands after the turn: the next turn, a replacement request, or the end of the game. */
function standingOf(copy: SimBattle, written: string[]): Omit<RolledCopy, 'flip'> {
  const stage = copy.ended ? 'ended' : hasForceSwitch(copy, 0) || hasForceSwitch(copy, 1) ? 'request' : 'turn';
  const events = extractProtocolEvents([...written]);
  return {
    serialized: serializeLiveBattle(copy), stage, log: written, events,
    terminal: stage === 'ended' ? terminalScore(copy, events.winner) : null,
  };
}

/** Plays the logged turn with one die turned over; null where the log has no such die, the turn cannot be played, or the position is no turn start. */
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
    // a turn the forced path cannot play (it ends a game the log goes on past) has no copy either
    if (!dice) return null;
    const flip = roll ? rolledKey(dice, battle, roll) : key;
    if (flip === null) return null;
    const played = flip === undefined ? dice : turnedOver(dice, flip);
    if (!played) return null;
    // The copy plays under the seed the rebuild found for the dice no `DieKind` names
    const copy = forkBattle({ serialized: position }, playSeed);
    const start = copy.log.length;
    playBlockOnCopy({ copy, dice: played, choices, forced: aligned.alignForced, bench, stopAtRequest: true });
    return { ...standingOf(copy as SimBattle, copy.log.slice(start)), ...(flip !== undefined ? { flip } : {}) };
  } catch {
    return null;
  }
}
