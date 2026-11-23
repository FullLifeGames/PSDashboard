import type { TurnAnalysis } from '../analysis.ts';
import { playedBest } from './phrases.ts';
import type { NamedJudgement } from './ride-along.ts';

/**
 * The words of a quiet turn, in one place: the estimate moved less than a mistake band and no one earned a grade. A card that
 * names an inaccuracy or a risk gives that sentence way. The badge text lives in `src/components/eval-badges.ts`.
 */
export const QUIET_TURN = 'A quiet turn.';
export const QUIET_TURN_BEST = "A quiet turn: both sides played the engine's preferred line.";
export const NEITHER_MISTAKE = 'Neither side made a mistake.';
export const BOTH_BEST = "Both sides played the engine's preferred line.";

/**
 * A body knocked out before it moved played nothing, so "both sides played" would credit it with a move. Names the side that moved
 * when it played the engine's line and the other never acted.
 */
function onlyMoverBest(analysis: TurnAnalysis, playerNames: [string, string]): string | null {
  const sides = [['p1', playerNames[0]], ['p2', playerNames[1]]] as const;
  const idle = sides.filter(([key]) => analysis[key].neverActed === true);
  if (idle.length !== 1) return null;
  const mover = sides.find(([key]) => analysis[key].neverActed !== true)!;
  return playedBest(analysis[mover[0]]) ? mover[1] : null;
}

/** How a quiet card speaks: the quiet sentence alone, as `no-mistake`, `silent` (a side has a mistake tier), or a concrete `risk` or `inaccuracy` sentence. */
export type QuietVoice = 'alone' | 'no-mistake' | 'silent' | 'risk' | 'inaccuracy';

/** A hindsight hint that a side row shows (`SideRow.tsx`). */
export function hintShown(analysis: TurnAnalysis): boolean {
  return [analysis.p1, analysis.p2].some(side => side.hindsightRead?.shown === true && !!side.hindsightRead.line);
}

const gradedMistake = (analysis: TurnAnalysis): boolean =>
  [analysis.p1, analysis.p2].some(side => side.tier === 'mistake' || side.tier === 'blunder');

export function quietVoiceOf(analysis: TurnAnalysis, othersSpeak: boolean, judged: readonly NamedJudgement[] = []): QuietVoice {
  if (judged.includes('risk')) return 'risk';
  if (judged.includes('inaccuracy')) return 'inaccuracy';
  if (!othersSpeak) return 'alone';
  return gradedMistake(analysis) ? 'silent' : 'no-mistake';
}

export function quietSentence(analysis: TurnAnalysis, voice: QuietVoice, playerNames: [string, string]): string | null {
  const mover = onlyMoverBest(analysis, playerNames);
  const both = playedBest(analysis.p1) && playedBest(analysis.p2) && !analysis.p1.neverActed && !analysis.p2.neverActed;
  if (voice === 'alone') return both ? QUIET_TURN_BEST : mover ? `A quiet turn: ${mover} played the engine's preferred line.` : QUIET_TURN;
  if (voice === 'no-mistake') return both ? BOTH_BEST : mover ? `${mover} played the engine's preferred line.` : NEITHER_MISTAKE;
  return null;
}

export function quietSentences(
  analysis: TurnAnalysis, walked: string | null, othersSpeak: boolean, playerNames: [string, string], judged: readonly NamedJudgement[] = [],
): string[] {
  const sentence = quietSentence(analysis, quietVoiceOf(analysis, othersSpeak || walked !== null, judged), playerNames);
  return [...(sentence ? [sentence] : []), ...(walked ? [walked] : [])];
}
