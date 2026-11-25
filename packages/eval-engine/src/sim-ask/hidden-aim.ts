import { toID, type Battle } from '@pkmn/sim';
import { FixedDice, playOnCopy } from './copy.ts';

// The simulator blanks the target of a move line when no animation plays (`attrLastMove('[still]')`),
// e.g. `|move|p2b: Sableye|Disable||[still]` for a Disable that fails on a body without a last move.

export const hidesItsTarget = (line: string): boolean => line.startsWith('|move|') && line.split('|')[4] === '' && line.includes('[still]');

export interface HiddenAimAsk {
  /** The mover's identifier in the log's form: side and slot with the colon (`p2b:`). */
  ident: string;
  moveId: string;
  /** The legal aims in the order of preference; the first is the default aim. */
  aims: readonly number[];
  choicesFor(aim: number): { p1: string; p2: string };
}

const ownMoveLine = (lines: readonly string[], { ident, moveId }: HiddenAimAsk): string | undefined =>
  lines.find(line => line.startsWith(`|move|${ident}`) && !line.includes('[from]') && toID(line.split('|')[3]) === moveId);

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

/** The first aim, in the asker's order, whose play fails as logged; null when none does or only one aim is legal. */
export function aimThatFailsAsLogged(live: Battle, ask: HiddenAimAsk): number | null {
  if (ask.aims.length < 2) return null;
  return ask.aims.find(aim => failsAsLogged(live, ask, aim)) ?? null;
}
