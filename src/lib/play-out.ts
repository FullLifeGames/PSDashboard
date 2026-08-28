import type { EvalResult, RankedChoice } from './eval/types';

/** Safety ceiling per play-out run (spec: 100 executed entries). */
export const PLAY_OUT_CAP = 100;

export type PlayOutStep =
  | { kind: 'pair'; p1: RankedChoice; p2: RankedChoice }
  | { kind: 'single'; side: 'p1' | 'p2'; choice: RankedChoice }
  | { kind: 'done'; reason: 'ended' | 'cap' | 'no-choices' };

/** A side's best PLAYABLE choice. The eval ranks a waiting side (forced-
 *  switch interludes) as the 'wait' sentinel — nothing to submit there. */
function actionable(choices: RankedChoice[]): RankedChoice | null {
  return choices.find(choice => choice.choice !== 'wait') ?? null;
}

/**
 * One decision of the engine-vs-engine loop ("Let it play out"): both
 * sides' top ranked choice, a single side's when the position is one-sided
 * (forced switches leave the other side waiting), or the stop verdict.
 * Pure — the caller owns execution and re-evaluation.
 */
export function nextPlayOutStep(result: EvalResult, battleEnded: boolean, executed: number): PlayOutStep {
  if (battleEnded) return { kind: 'done', reason: 'ended' };
  if (executed >= PLAY_OUT_CAP) return { kind: 'done', reason: 'cap' };
  const p1 = actionable(result.perSide.p1);
  const p2 = actionable(result.perSide.p2);
  if (p1 && p2) return { kind: 'pair', p1, p2 };
  if (p1) return { kind: 'single', side: 'p1', choice: p1 };
  if (p2) return { kind: 'single', side: 'p2', choice: p2 };
  return { kind: 'done', reason: 'no-choices' };
}

/** Human sentence for why a play-out ended (shown in the panel notice). */
export function playOutDoneText(reason: 'ended' | 'cap' | 'no-choices', executed: number): string {
  const turns = `${executed} turn${executed === 1 ? '' : 's'}`;
  if (reason === 'ended') return `Play-out finished — the battle ended after ${turns}.`;
  if (reason === 'cap') return `Play-out stopped at the ${PLAY_OUT_CAP}-turn safety cap (${turns} played).`;
  return `Play-out stopped after ${turns} — the engine offered no playable choice.`;
}
