import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';

/** Safety ceiling per play-out run, in executed entries. */
export const PLAY_OUT_CAP = 100;

/** The "fast play-out" engine: the depth-1 matrix on every turn instead of the Auto line (search/budget.ts), several times faster wherever Auto runs the tree and weaker there. */
export const FAST_PLAY_OUT_SETTINGS = { depth: 1, samples: 1, mode: 'matrix' } as const;

export type PlayOutStep =
  | { kind: 'pair'; p1: RankedChoice; p2: RankedChoice }
  | { kind: 'single'; side: 'p1' | 'p2'; choice: RankedChoice }
  | { kind: 'done'; reason: 'ended' | 'cap' | 'no-choices' };

/** A side's best playable choice: the eval ranks a waiting side (forced-switch interludes) as the 'wait' sentinel, nothing to submit. */
function actionable(choices: RankedChoice[]): RankedChoice | null {
  return choices.find(choice => choice.choice !== 'wait') ?? null;
}

/** One decision of "Let it play out": both sides' top choice, a single side's when the position is one-sided (forced switches), or the stop verdict. */
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

/** The preferences a run gives back: the run switched Auto on for its evaluations, so the user's own setting returns when it ends. Null when nothing needs to change. */
export function prefsAfterRun<T extends { auto: boolean }>(prefs: T, run: { prevAuto: boolean }): T | null {
  return run.prevAuto ? null : { ...prefs, auto: false };
}

/** The panel notice for why a play-out ended. */
export function playOutDoneText(reason: 'ended' | 'cap' | 'no-choices', executed: number): string {
  const turns = `${executed} turn${executed === 1 ? '' : 's'}`;
  if (reason === 'ended') return `Play-out finished: the battle ended after ${turns}.`;
  if (reason === 'cap') return `Play-out stopped at the ${PLAY_OUT_CAP}-turn safety cap (${turns} played).`;
  return `Play-out stopped after ${turns}: the engine offered no playable choice.`;
}
