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
export function quietSentence(analysis: TurnAnalysis, voice: QuietVoice): string | null {
  const best = playedBest(analysis.p1) && playedBest(analysis.p2);
  if (voice === 'alone') return best ? QUIET_TURN_BEST : QUIET_TURN;
  if (voice === 'no-mistake') return best ? BOTH_BEST : NEITHER_MISTAKE;
  return null;
}

/** The quiet part of a card's attribution sentences: the quiet sentence, then the walked read (round 76, T233). */
export function quietSentences(analysis: TurnAnalysis, walked: string | null, othersSpeak: boolean): string[] {
  const sentence = quietSentence(analysis, quietVoiceOf(analysis, othersSpeak || walked !== null));
  return [...(sentence ? [sentence] : []), ...(walked ? [walked] : [])];
}
