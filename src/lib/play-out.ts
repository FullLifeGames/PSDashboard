import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';

/** Safety ceiling per play-out run, in executed entries. */
export const PLAY_OUT_CAP = 100;

/** The "fast play-out" engine: the depth-1 matrix every turn instead of Auto; faster where Auto runs the tree. */
export const FAST_PLAY_OUT_SETTINGS = { depth: 1, samples: 1, mode: 'matrix' } as const;

export type PlayOutStep =
  | { kind: 'pair'; p1: RankedChoice; p2: RankedChoice }
  | { kind: 'single'; side: 'p1' | 'p2'; choice: RankedChoice }
  | { kind: 'done'; reason: 'ended' | 'cap' | 'no-choices' };

// The eval ranks a waiting side (a forced-switch interlude) as the 'wait' sentinel: nothing to submit.
function actionable(choices: RankedChoice[]): RankedChoice | null {
  return choices.find(choice => choice.choice !== 'wait') ?? null;
}

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

/** The preferences a run gives back (it switched Auto on, the user's setting returns); null when nothing changes. */
export function prefsAfterRun<T extends { auto: boolean }>(prefs: T, run: { prevAuto: boolean }): T | null {
  return run.prevAuto ? null : { ...prefs, auto: false };
}

export function playOutDoneText(reason: 'ended' | 'cap' | 'no-choices', executed: number): string {
  const turns = `${executed} turn${executed === 1 ? '' : 's'}`;
  if (reason === 'ended') return `Play-out finished: the battle ended after ${turns}.`;
  if (reason === 'cap') return `Play-out stopped at the ${PLAY_OUT_CAP}-turn safety cap (${turns} played).`;
  return `Play-out stopped after ${turns}: the engine offered no playable choice.`;
}
