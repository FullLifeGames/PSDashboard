import { describe, expect, test } from 'vitest';
import type { EvalLine, WinStep } from '@fulllifegames/eval-engine';
import { chanceText, ordinal, winStepViews, type WinPathsViewContext } from '../../../src/lib/win-paths-view';
import { doublesLine, DOUBLES_NAMES, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/**
 * Round 89 (#130, G8b): the words of the win-path panel, as the user ruled them (14.11.2026, W1a to W5a), singles and doubles.
 */
const ctx = (extra: Partial<WinPathsViewContext> = {}): WinPathsViewContext =>
  ({ turn: 23, playerNames: SINGLES_NAMES, doubles: false, host: { rules: { gen: 9, mod: undefined } }, side: 'p2', playedLabel: null, ...extra });
const spent = { cells: 3, turns: 5 };
const step = (kind: WinStep['kind'], status: WinStep['status'], extra: Partial<WinStep> = {}): WinStep => ({ kind, status, spent, ...extra });
const line = (extra: Partial<EvalLine> = {}): EvalLine => ({ ...singlesLine, for: [], ...extra });

describe('the win-path words', () => {
  test('the step names and the empty sentences (W5a, W4a)', () => {
    const views = winStepViews([step('stronger', 'none'), step('luck', 'none'), step('mistake', 'none')], ctx());
    expect(views.map(view => view.title)).toEqual(['1 · A stronger play', '2 · Luck', '3 · A mistake by Tzon']);
    expect(views.map(view => view.empty)).toEqual(['None within 3 turns.', 'None within 3 turns at 1 in 1,000 or better.', 'None within 3 turns.']);
    expect(views.every(view => view.block === null && view.headline === null)).toBe(true);
  });

  test('a stopped step and a failed one each have one sentence', () => {
    const [stopped, failed] = winStepViews([step('luck', 'stopped'), step('stronger', 'failed', { error: 'broke' })], ctx());
    expect(stopped.empty).toBe('Stopped at the search limit; nothing found so far.');
    expect(failed.empty).toBe('This step could not run.');
    expect(failed.empty).not.toContain('broke');
  });

  test('step 1 names the chance whatever the opponent answers, beside the played choice (W1a)', () => {
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.5175, played: 0, line: line() })], ctx({ playedLabel: 'Hydro Pump' }));
    expect(view.headline).toBe('Hydro Pump wins within 3 turns in 52 % of the dice whatever Tzon plays. Played Hydro Pump: 0 %.');
    expect(view.empty).toBeNull();
    expect(view.block?.line.label).toBe('Hydro Pump');
    expect(view.block?.tooltip).toContain('Play this line as a variation');
  });

  test('step 1 without a played choice in the log shows the number alone; in doubles it says the rolls were sampled', () => {
    const [single] = winStepViews([step('stronger', 'found', { chance: 1, line: line() })], ctx());
    expect(single.headline).toBe('Hydro Pump wins within 3 turns in 100 % of the dice whatever Tzon plays.');
    const [pair] = winStepViews([step('stronger', 'found', { chance: 0.25, played: 0.1, line: { ...doublesLine, for: [] } })], ctx({ playerNames: DOUBLES_NAMES, doubles: true, side: 'p1', playedLabel: 'Protect + Protect' }));
    expect(pair.headline).toBe('Fake Out → Rillaboom + Spore → Zamazenta wins within 3 turns in 25 % of the dice whatever Mstr_Hawk plays (over sampled rolls). Played Protect + Protect: 10 %.');
    // one row per player and step, the chips of the dice that could have gone the other way
    expect(pair.block?.rows.length).toBeGreaterThan(3);
  });

  test('step 2 names the chance of the dice, with its chips on the rows', () => {
    const [view] = winStepViews([step('luck', 'found', { chance: 0.108, line: line() })], ctx());
    expect(view.headline).toBe('This sequence: 10.8 %.');
    expect(view.block?.rows.flatMap(row => row.sides.flatMap(side => side.chips)).length).toBeGreaterThan(0);
  });

  test('step 3 names the slip by its rank and turn, then the chance of the dice (W3a)', () => {
    const [view] = winStepViews([step('mistake', 'found', { chance: 0.84375, deviation: { turn: 24, label: 'Scald', rank: 2 }, line: line() })], ctx());
    expect(view.headline).toBe('If Tzon had played Scald (its 2nd choice) on turn 24. This sequence: 84 %.');
  });

  test('chances and ordinals', () => {
    expect([0.0005, 0.004, 0.108, 0.19, 0.2, 0.5175, 1].map(chanceText)).toEqual(['0.1 %', '0.4 %', '10.8 %', '19 %', '20 %', '52 %', '100 %']);
    expect([2, 3, 4, 11].map(ordinal)).toEqual(['2nd', '3rd', '4th', '11th']);
  });

  test('a found step with no line (the witness search found none) keeps its sentence and shows no play button data', () => {
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.6 })], ctx());
    expect(view.block).toBeNull();
    expect(view.headline).toContain('60 %');
  });
});
