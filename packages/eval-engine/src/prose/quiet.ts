import type { TurnAnalysis } from '../analysis.ts';
import { playedBest } from './phrases.ts';

/**
 * Round 89 (B8a): the words of a quiet turn, in one place. "A quiet turn." means the estimate moved less than a mistake band and
 * no one earned a grade. It stands only on a card that highlights nothing else; beside another sentence or a shown hint the card
 * says that no one made a mistake, which is what the grades say there (an inaccuracy is "a minor imprecision, not a mistake").
 * The user decides the final wording at the gate of round 89; the badge text lives in `src/components/eval-badges.ts`.
 */
export const QUIET_TURN = 'A quiet turn.';
export const QUIET_TURN_BEST = "A quiet turn: both sides played the engine's preferred line.";
export const NEITHER_MISTAKE = 'Neither side made a mistake.';
export const BOTH_BEST = "Both sides played the engine's preferred line.";

/**
 * Round 89 (FT-1b): a body knocked out before it moved played nothing, and the stand-in the engine grades for it is no play, so
 * "both sides played" would credit it with a move (655336 t28). The sentence names the side that moved when that side played the
 * engine's line and the other never acted; two sides that never acted, or a mover off the engine's line, keep the plain words.
 */
function onlyMoverBest(analysis: TurnAnalysis, playerNames: [string, string]): string | null {
  const sides = [['p1', playerNames[0]], ['p2', playerNames[1]]] as const;
  const idle = sides.filter(([key]) => analysis[key].neverActed === true);
  if (idle.length !== 1) return null;
  const mover = sides.find(([key]) => analysis[key].neverActed !== true)!;
  return playedBest(analysis[mover[0]]) ? mover[1] : null;
}

/**
 * How a quiet card speaks: `alone` (nothing else on the card, the quiet sentence), `no-mistake` (something else speaks, no side
 * carries a mistake or blunder tier), `silent` (something else speaks and a side carries such a tier, so no sentence is true).
 */
export type QuietVoice = 'alone' | 'no-mistake' | 'silent';

/** A hindsight hint a side row shows (`SideRow.tsx`: `hindsightRead.shown` and a line). */
export function hintShown(analysis: TurnAnalysis): boolean {
  return [analysis.p1, analysis.p2].some(side => side.hindsightRead?.shown === true && !!side.hindsightRead.line);
}

const gradedMistake = (analysis: TurnAnalysis): boolean =>
  [analysis.p1, analysis.p2].some(side => side.tier === 'mistake' || side.tier === 'blunder');

/** The voice of a quiet card, from whether anything else speaks on it (a sentence or a shown hint). */
export function quietVoiceOf(analysis: TurnAnalysis, othersSpeak: boolean): QuietVoice {
  if (!othersSpeak) return 'alone';
  return gradedMistake(analysis) ? 'silent' : 'no-mistake';
}

/** The quiet sentence of a tracked card, or none. */
export function quietSentence(analysis: TurnAnalysis, voice: QuietVoice, playerNames: [string, string]): string | null {
  const mover = onlyMoverBest(analysis, playerNames);
  const both = playedBest(analysis.p1) && playedBest(analysis.p2) && !analysis.p1.neverActed && !analysis.p2.neverActed;
  if (voice === 'alone') return both ? QUIET_TURN_BEST : mover ? `A quiet turn: ${mover} played the engine's preferred line.` : QUIET_TURN;
  if (voice === 'no-mistake') return both ? BOTH_BEST : mover ? `${mover} played the engine's preferred line.` : NEITHER_MISTAKE;
  return null;
}

/** The quiet part of a card's attribution sentences: the quiet sentence, then the walked read (round 76, T233). */
export function quietSentences(analysis: TurnAnalysis, walked: string | null, othersSpeak: boolean, playerNames: [string, string]): string[] {
  const sentence = quietSentence(analysis, quietVoiceOf(analysis, othersSpeak || walked !== null), playerNames);
  return [...(sentence ? [sentence] : []), ...(walked ? [walked] : [])];
}
