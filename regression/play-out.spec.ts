import { expect, test } from '@playwright/test';
import { nextPlayOutStep, PLAY_OUT_CAP } from '../src/lib/play-out';
import type { EvalResult, RankedChoice } from '../src/lib/eval/types';

const ranked = (choice: string): RankedChoice =>
  ({ choice, label: choice, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
const result = (p1: string[], p2: string[]): EvalResult => ({
  score: 0,
  interval: 0,
  depthCompleted: 1,
  perSide: { p1: p1.map(ranked), p2: p2.map(ranked) },
});

test('plays the top pair while both sides have choices', () => {
  const step = nextPlayOutStep(result(['move earthquake', 'move outrage'], ['move recover']), false, 0);
  expect(step).toEqual({ kind: 'pair', p1: ranked('move earthquake'), p2: ranked('move recover') });
});

test('a one-sided position becomes a single (forced) step', () => {
  expect(nextPlayOutStep(result(['switch 2'], []), false, 3))
    .toEqual({ kind: 'single', side: 'p1', choice: ranked('switch 2') });
  expect(nextPlayOutStep(result([], ['switch 3']), false, 3))
    .toEqual({ kind: 'single', side: 'p2', choice: ranked('switch 3') });
});

test('stops on end, cap, and empty positions', () => {
  expect(nextPlayOutStep(result(['move x'], ['move y']), true, 0)).toEqual({ kind: 'done', reason: 'ended' });
  expect(nextPlayOutStep(result(['move x'], ['move y']), false, PLAY_OUT_CAP)).toEqual({ kind: 'done', reason: 'cap' });
  expect(nextPlayOutStep(result([], []), false, 0)).toEqual({ kind: 'done', reason: 'no-choices' });
});
