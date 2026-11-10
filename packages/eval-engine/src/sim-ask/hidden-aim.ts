import { toID, type Battle } from '@pkmn/sim';
import { FixedDice, playOnCopy } from './copy.ts';

/**
 * Round 89 (#136): the aim of a move whose target the protocol hides. The simulator blanks the target of a move line when no animation
 * plays (`attrLastMove('[still]')`, "if no animation plays, the target should never be known"): a Disable that fails on a body without a
 * last move, an Encore on a body that has not moved, any single-target move that the game stops before it animates. The log shows
 * `|move|p2b: Sableye|Disable||[still]` and the click's aim is lost. The question asks the simulator: play the turn on a copy of the
 * battle with each legal aim and keep the first that makes the move fail as the log shows (the move line with its target blanked).
 * The turn runs with the dice of a likely game (`FixedDice` with `likely`: an accuracy hits, a secondary effect does not), and a
 * play that the simulator refuses or that never reaches the move counts as "does not fail as logged".
 */

/** A `|move|` line that hides its target: an empty target field and the `[still]` mark (the log of a failed move). */
export const hidesItsTarget = (line: string): boolean => line.startsWith('|move|') && line.split('|')[4] === '' && line.includes('[still]');

export interface HiddenAimAsk {
  /** The mover's identifier in the log's form, side and slot with the colon: `p2b:`. */
  ident: string;
  /** The move the log shows. */
  moveId: string;
  /** The legal aims in the order of preference; the first is the default aim. */
  aims: readonly number[];
  /** The choice of each side for the turn when the mover aims at `aim` (the other bodies as the rebuild chooses them). */
  choicesFor(aim: number): { p1: string; p2: string };
}

/** The move line the mover's own click writes in the copy's new lines: the first without a `[from]` source. */
const ownMoveLine = (lines: readonly string[], { ident, moveId }: HiddenAimAsk): string | undefined =>
  lines.find(line => line.startsWith(`|move|${ident}`) && !line.includes('[from]') && toID(line.split('|')[3]) === moveId);

/** Does the turn with this aim make the move line the log shows? False when the simulator refuses a choice or the mover never moves. */
function failsAsLogged(live: Battle, ask: HiddenAimAsk, aim: number): boolean {
  const choices = ask.choicesFor(aim);
  return playOnCopy(live, new FixedDice({ likely: true }), copy => {
    const before = copy.log.length;
    try {
      if (!copy.choose('p1', choices.p1) || !copy.choose('p2', choices.p2)) return false;
    } catch {
      return false;
    }
    const line = ownMoveLine(copy.log.slice(before), ask);
    return line !== undefined && hidesItsTarget(line);
  });
}

/**
 * The first aim, in the asker's order, whose play fails as the log shows; null when none does (the asker keeps its default aim). With
 * one legal aim there is nothing to ask.
 */
export function aimThatFailsAsLogged(live: Battle, ask: HiddenAimAsk): number | null {
  if (ask.aims.length < 2) return null;
  return ask.aims.find(aim => failsAsLogged(live, ask, aim)) ?? null;
}
