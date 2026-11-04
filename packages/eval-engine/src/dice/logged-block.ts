import type { Battle } from '@pkmn/sim';
import { loggedDice } from './logged-results.ts';
import { playForcedTurn, type ForcedTurnInput } from './play.ts';
import { loggedOptions } from './turn.ts';
import type { DiceReport, ForcedDie } from './types.ts';

/**
 * Round 86 (the log's dice, T306): a logged turn through the dice module. The reconstruction used to replay a block's choices under the
 * best of sixteen seeds; now it plays them under the hidden dice of one frozen seed (index 0 of `ALIGNMENT_SEEDS`) with the dice the
 * log shows forced on top (ADR 0008, decision 4a). Three callers share this file: the reconstruction (`branch/runtime.ts`), the arrival
 * and the adopt (`branch/arrival-dice.ts`, which records the draws of the same turn), and the branch's first turn (`dice/turn.ts`
 * joins the same list to the user's dice).
 *
 * A block plays in parts: the choices of both sides, then every answer to a forced replacement that follows. Each part runs through
 * `playForcedTurn` with the whole turn's list, the way a `PendingTurn` carries a branch's list over a pause for a switch: a die an
 * earlier part drew is no draw in a later one, and every part ends the stream on the natural turn's seed at its place (decision D8), so
 * the parts chain into the whole turn.
 */

/** The choices of both sides, as the stream writes them (`>p1 move 1`). */
export interface BlockCommands { p1: string; p2: string }

/**
 * The dice the log shows for a block: its lines and the commands the log's players sent, read against the battle that stands at the
 * move request of that turn (it names the clicked moves, the checks and the stalling conditions the log cannot).
 */
export function forcedTurnDice(battle: Battle, lines: readonly string[], choices: BlockCommands): ForcedDie[] {
  return loggedDice(lines, loggedOptions(battle, choices));
}

/** The commands on a copy of the battle, as the stream writes them to the live one; a refused choice ends the play. */
export function chooseOnCopy(battle: Battle, commands: readonly { side: 'p1' | 'p2'; command: string }[]): void {
  for (const { side, command } of commands) {
    if (battle.choose(side, command)) continue;
    throw new Error(battle.sides[side === 'p1' ? 0 : 1].choice.error || 'The simulator rejected this choice.');
  }
}

export interface BlockPart {
  live: Battle;
  dice: readonly ForcedDie[];
  commands: readonly { side: 'p1' | 'p2'; command: string }[];
  /** Writes the commands to the live battle (the stream's `writeSim`). */
  write: () => void;
  observe?: ForcedTurnInput['observe'];
}

/** One part of a block: the natural turn on a copy (a choice the copy refuses throws before the live battle is touched), then the real one. */
export function playBlockPart({ live, dice, commands, write, observe }: BlockPart): DiceReport {
  return playForcedTurn({ live, forced: dice, observe, play: battle => (battle === live ? write() : chooseOnCopy(battle, commands)) });
}

/**
 * A part of a block written to the live battle through the dice module. False means the module could not play it: the natural turn threw
 * (a choice the simulator refuses) before the live battle got anything, so the caller may write the part plain or search a seed. A throw
 * after the live write counts as played.
 */
export function writeBlockPart(part: BlockPart): boolean {
  const logLength = part.live.log.length;
  try {
    playBlockPart(part);
  } catch {
    if (part.live.log.length === logLength) return false;
  }
  return true;
}

/** The log's dice of a block, or null where the reader fails on an odd state (the block then takes the seed search). */
export function forcedTurnDiceOrNull(battle: Battle, lines: readonly string[], choices: BlockCommands): ForcedDie[] | null {
  try {
    return forcedTurnDice(battle, lines, choices);
  } catch {
    return null;
  }
}
