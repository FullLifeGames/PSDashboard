import { faintStep, forcedTurnDice, playBlockOnCopy, protocolBenchOf } from '../dice/logged-block.ts';
import { dieKey, type ForcedDie } from '../dice/types.ts';
import { forkBattle } from '../forward/position.ts';
import { ALIGNMENT_SEEDS, extractProtocolEvents, type ProtocolEvents } from '../hax-alignment.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import { serializeLiveBattle } from '../serialize.ts';
import { forcedBlock } from './arrival-dice.ts';
import { hasForceSwitch } from './corrections.ts';
import { getMainChoice, parseTurnBlocks } from './protocol-choices.ts';
import type { SimBattle } from './types.ts';

/**
 * Round 86 (the engine reads the dice, T304): the copy of a logged turn with one die turned over. The report names the game's biggest roll
 * (`biggest-roll.ts`) and asks what the other side of the die would have left: a Fire Fang that missed hits, a Gunk Shot that hit misses.
 * The copy starts from the position at the turn's start, plays the turn the way the reconstruction plays it (the choices the log shows,
 * seed index 0, every die the log shows forced, the faint step and the phantom-proc rule of T306 included, `faintStep`) and turns the one
 * die over before the play. The faint step searches the damage rolls that make the log's faints, so it runs on the log's turn; the turned
 * die then plays on top of its result and the faints may differ from the log's. Only the dice the log names are turned: a die the log does
 * not show gives no copy, and the sentence speaks only where the log names the event (gate 30.10.2026, 2a).
 *
 * The copy stops where the turn opens a request for a replacement (ruling Q7, the path of the sweep's replacement round, T290): the next
 * root is then the open request, which the engine prices like any forced replacement and which ranks the replacing side's options. The
 * hit's own damage roll, crit and secondary are no die of the log (the log shows a miss), so they fall to the hidden dice of the seed.
 * No snapshot corrects the copy's position (the log shows the other side of the die), so it carries what the simulator gives.
 */

export interface RolledCopyInput {
  /** The serialized position at the start of `turn` (the sweep's boundary position). */
  position: string;
  replayLog: string;
  turn: number;
  /** The die to turn over (`dieKey`): a chance of the log's turn. Omitted: the control copy, the log's own turn. */
  flip?: string;
}

export interface RolledCopy {
  /** The position of the next root. */
  serialized: string;
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

export function rolledCopy({ position, replayLog, turn, flip }: RolledCopyInput): RolledCopy | null {
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
    const { dice } = faintStep({
      battle, expected: aligned.expectedEvents, seed, choices, lines, forced: aligned.alignForced, bench,
    }, forcedTurnDice(battle, lines, choices));
    // a turn the forced path cannot play (it ends a game the log goes on past) has no copy either
    if (!dice) return null;
    const played = flip === undefined ? dice : turnedOver(dice, flip);
    if (!played) return null;
    const copy = forkBattle({ serialized: position }, seed);
    const start = copy.log.length;
    playBlockOnCopy({ copy, dice: played, choices, forced: aligned.alignForced, bench, stopAtRequest: true });
    const written = copy.log.slice(start);
    const stage = copy.ended ? 'ended' : hasForceSwitch(copy, 0) || hasForceSwitch(copy, 1) ? 'request' : 'turn';
    return { serialized: serializeLiveBattle(copy), stage, log: written, events: extractProtocolEvents([...written]) };
  } catch {
    return null;
  }
}
