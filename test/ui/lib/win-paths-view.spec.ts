import { describe, expect, test } from 'vitest';
import type { EvalLine, WinStep } from '@fulllifegames/eval-engine';
import { chanceText, rankWords, sequenceNote, winStepViews, type WinPathsViewContext } from '../../../src/lib/win-paths-view';
import { doublesLine, DOUBLES_NAMES, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

const ctx = (extra: Partial<WinPathsViewContext> = {}): WinPathsViewContext =>
  ({ turn: 23, playerNames: SINGLES_NAMES, doubles: false, host: { rules: { gen: 9, mod: undefined } }, side: 'p2', playedLabel: null, ...extra });
const spent = { cells: 3, turns: 5 };
const step = (kind: WinStep['kind'], status: WinStep['status'], extra: Partial<WinStep> = {}): WinStep => ({ kind, status, spent, ...extra });
const line = (extra: Partial<EvalLine> = {}): EvalLine => ({ ...singlesLine, for: [], ...extra });

describe('the win-path words', () => {
  test('the step names and the empty sentences', () => {
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

  test('step 1 names the chance whatever the opponent answers, beside the played choice', () => {
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.5175, played: 0, line: line() })], ctx({ playedLabel: 'Hydro Pump' }));
    expect(view.headline).toBe('Hydro Pump wins within 3 turns in 52 % of the dice whatever Tzon plays. What Pepitopalotin played, Hydro Pump, wins in 0 % of the dice.');
    expect(view.empty).toBeNull();
    expect(view.block?.line.label).toBe('Hydro Pump');
    expect(view.block?.tooltip).toContain('Play this line as a variation');
  });

  test('step 1 without a played choice in the log shows the number alone; in doubles it says the rolls were sampled', () => {
    const [single] = winStepViews([step('stronger', 'found', { chance: 1, line: line() })], ctx());
    expect(single.headline).toBe('Hydro Pump wins within 3 turns in 100 % of the dice whatever Tzon plays.');
    const [pair] = winStepViews([step('stronger', 'found', { chance: 0.25, played: 0.1, line: { ...doublesLine, for: [] } })], ctx({ playerNames: DOUBLES_NAMES, doubles: true, side: 'p1', playedLabel: 'Protect + Protect' }));
    expect(pair.headline).toBe('Fake Out → Rillaboom + Spore → Zamazenta wins within 3 turns in 25 % of the dice whatever Mstr_Hawk plays (over sampled rolls). What pixelfrost played, Protect + Protect, wins in 10 % of the dice.');
    expect(pair.block?.rows.length).toBeGreaterThan(3);
  });

  test('step 1 on a body that was knocked out before it moved says so instead of naming a choice', () => {
    const host = { rules: { gen: 9, mod: undefined }, snapshot: { p1: { pokemon: [{ name: 'Tentacruel', isActive: true }] }, p2: { pokemon: [{ name: 'Rotom-Wash', isActive: true }] } } } as unknown as WinPathsViewContext['host'];
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.106, played: 0.04, line: line() })], ctx({ host, playedLabel: 'stayed in (KO’d before acting)', playedNeverActed: true }));
    expect(view.headline).toBe('Hydro Pump wins within 3 turns in 10.6 % of the dice whatever Tzon plays. Rotom-Wash was knocked out before it moved, so the log shows no choice; staying in wins in 4 % of the dice.');
    expect(view.headline).not.toContain('Played');
  });

  test.each([
    ['a switch', '→ Corviknight', 'a switch to Corviknight'],
    ['a move with a target', 'Heat Wave→Ursaluna', 'Heat Wave on Ursaluna'],
    ['a Tera move', 'Tera + Hydro Pump', 'Terastallize and Hydro Pump'],
    ['a doubles pair', 'Fake Out→Rillaboom + Protect', 'Fake Out on Rillaboom + Protect'],
    ['a Mega move', 'Mega + Flare Blitz', 'Mega Evolve and Flare Blitz'],
  ])('the played choice is written in Showdown\'s words: %s', (_name, label, words) => {
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.5, played: 0.25, line: line() })], ctx({ playedLabel: label }));
    expect(view.headline).toContain(`What Pepitopalotin played, ${words}, wins in 25 % of the dice.`);
  });

  test('step 2 names the chance of the dice, with its chips on the rows', () => {
    const [view] = winStepViews([step('luck', 'found', { chance: 0.108, line: line() })], ctx());
    expect(view.headline).toBe('This sequence: 10.8 %.');
    expect(view.block?.rows.flatMap(row => row.sides.flatMap(side => side.chips)).length).toBeGreaterThan(0);
  });

  test('step 3 names the slip by its rank and turn, then the chance of the dice', () => {
    const [view] = winStepViews([step('mistake', 'found', { chance: 0.84375, deviation: { turn: 24, label: 'Scald', rank: 2 }, line: line() })], ctx());
    expect(view.headline).toBe('If Tzon had played Scald (its second choice) on turn 24, Pepitopalotin wins: this sequence has 84 %.');
  });

  test('step 3 is one sentence in singles and in doubles, with or without a chance', () => {
    const deviation = { turn: 23, label: 'Icy Wind', rank: 3 };
    const [singles] = winStepViews([step('mistake', 'found', { chance: 0.86, deviation, line: line() })], ctx());
    expect(singles.headline).toBe('If Tzon had played Icy Wind (its third choice) on turn 23, Pepitopalotin wins: this sequence has 86 %.');
    const [doubles] = winStepViews([step('mistake', 'found', { chance: 0.25, deviation, line: { ...doublesLine, for: [] } })], ctx({ playerNames: DOUBLES_NAMES, doubles: true, side: 'p1' }));
    expect(doubles.headline).toBe('If Mstr_Hawk had played Icy Wind (its third choice) on turn 23, pixelfrost wins: this sequence has 25 %.');
    const [bare] = winStepViews([step('mistake', 'found', { deviation, line: line() })], ctx());
    expect(bare.headline).toBe('If Tzon had played Icy Wind (its third choice) on turn 23, Pepitopalotin wins.');
    const [noSlip] = winStepViews([step('mistake', 'found', { chance: 0.5, line: line() })], ctx());
    expect(noSlip.headline).toBe('This sequence: 50 %.');
  });

  // A sequence's number multiplies the dice whose other result would change who faints; the stronger play's share
  // adds every winning sequence.
  test('a luck or mistake step that found a path carries the note on what its number counts; the other steps do not', () => {
    const found = (kind: WinStep['kind']) => winStepViews([step(kind, 'found', { chance: 0.5, line: line() })], ctx());
    expect(sequenceNote(found('luck'))).toBe('A sequence\'s chance multiplies the dice whose other result would change who faints; a die that changes nothing counts as certain, and other sequences that also win are not added.');
    expect(sequenceNote(found('mistake'))).not.toBeNull();
    expect(sequenceNote(found('stronger'))).toBeNull();
    expect(sequenceNote(winStepViews([step('luck', 'none'), step('mistake', 'stopped')], ctx()))).toBeNull();
    expect(sequenceNote(winStepViews([step('luck', 'found', { chance: 0.25, line: { ...doublesLine, for: [] } })], ctx({ playerNames: DOUBLES_NAMES, doubles: true, side: 'p1' })))).not.toBeNull();
  });

  test('chances and ordinals', () => {
    expect([0.0005, 0.004, 0.108, 0.19, 0.2, 0.5175, 1].map(chanceText)).toEqual(['0.1 %', '0.4 %', '10.8 %', '19 %', '20 %', '52 %', '100 %']);
    expect([2, 3, 4, 5, 10, 11, 12, 21, 22, 23].map(rankWords)).toEqual(['second choice', 'third choice', 'fourth choice', 'fifth choice', 'tenth choice', '11th choice', '12th choice', '21st choice', '22nd choice', '23rd choice']);
  });

  test('a found step with no line (the witness search found none) keeps its sentence and shows no play button data', () => {
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.6 })], ctx());
    expect(view.block).toBeNull();
    expect(view.headline).toContain('60 %');
  });
});

describe('the words of the winner\'s line', () => {
  const proof = (extra: Partial<WinPathsViewContext> = {}): WinPathsViewContext => ctx({ question: 'proof', turns: 2, ...extra });

  test('the step is the proof\'s line, and the sentence counts the proof\'s turns: one, then four', () => {
    const [one] = winStepViews([step('stronger', 'found', { chance: 1, line: line() })], proof({ turns: 1 }));
    expect(one.title).toBe('The proof\'s line');
    expect(one.headline).toBe('Hydro Pump wins within 1 turn in 100 % of the dice whatever Tzon plays.');
    const [four] = winStepViews([step('stronger', 'found', { chance: 0.667, line: line() })], proof({ turns: 4 }));
    expect(four.headline).toBe('Hydro Pump wins within 4 turns in 67 % of the dice whatever Tzon plays.');
  });

  test('in doubles the sentence says the rolls were sampled', () => {
    const [view] = winStepViews([step('stronger', 'found', { chance: 0.667, line: { ...doublesLine, for: [] } })], proof({ playerNames: DOUBLES_NAMES, doubles: true, side: 'p1', turns: 4 }));
    expect(view.headline).toBe('Fake Out → Rillaboom + Spore → Zamazenta wins within 4 turns in 67 % of the dice whatever Mstr_Hawk plays (over sampled rolls).');
  });

  test('a player who chose the line\'s first choice is told so; another choice keeps the sentence of the stronger play', () => {
    const found = step('stronger', 'found', { chance: 1, played: 1, line: line() });
    expect(winStepViews([found], proof({ playedLabel: 'Hydro Pump' }))[0].headline).toBe('Hydro Pump wins within 2 turns in 100 % of the dice whatever Tzon plays. Pepitopalotin played this choice.');
    expect(winStepViews([found], proof({ playedLabel: 'Scald' }))[0].headline).toBe('Hydro Pump wins within 2 turns in 100 % of the dice whatever Tzon plays. What Pepitopalotin played, Scald, wins in 100 % of the dice.');
    const never = winStepViews([found], proof({ playedLabel: 'stayed in (KO’d before acting)', playedNeverActed: true }))[0].headline;
    expect(never).toContain('was knocked out before it moved');
  });

  test('a proof that did not replay, one that hit the limit and one that failed each have one sentence', () => {
    const views = winStepViews([step('stronger', 'none'), step('stronger', 'stopped'), step('stronger', 'failed')], proof({ turns: 1 }));
    expect(views.map(view => view.empty)).toEqual(['The proof did not replay within 1 turn.', 'Stopped at the search limit; nothing found so far.', 'This step could not run.']);
    expect(winStepViews([step('stronger', 'none')], proof({ turns: 3 }))[0].empty).toBe('The proof did not replay within 3 turns.');
  });
});

