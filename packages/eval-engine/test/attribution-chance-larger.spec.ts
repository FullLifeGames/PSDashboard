import { describe, expect, test } from 'vitest';
import { analyzeTurn, CHANCE_THRESHOLD, type SideAnalysis, type TurnAnalysis } from '../src/analysis';
import { shownAttribution } from '../src/turn-analysis/risk';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 70 (gate of 13.10.2026 20:26, 2a): the chance attribution names a turn only when the chance part is the larger part
 * of the swing. The rule used to read: any residual of a mistake band (0.2) is a chance swing. In VGC 2630685175 turn 7 the
 * played pair lost 1.34 against the position before the turn (the Wide Guard it walked into) and the engine re-read the
 * position by 0.42 more, so the card called a 1.76 swing "chance" (the engine re-read the position) and never named the
 * turn's cause. 11 of the 55 chance turns of the ten feedback games read that way. A chance part that is not the larger one
 * leaves the turn to the swing's own reading: a shift when the swing is a band, quiet when the two parts cancel.
 */

const row = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const names: [string, string] = ['Alpha', 'Beta'];

interface Shape {
  result: EvalResult;
  played: PlayedTurn;
}

/** Both sides play the one option they have, which is the engine's best: no culprit can exist, only the movement is left to read. */
const singles = (): Shape => ({
  result: {
    score: 0.1, interval: 0.02, depthCompleted: 1,
    perSide: { p1: [row('move dracometeor', 'Draco Meteor', 0.2)], p2: [row('switch 3', '→ Dragapult', -0.05)] },
  },
  played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
});

const doubles = (): Shape => ({
  result: {
    score: 0.1, interval: 0.02, depthCompleted: 1,
    perSide: {
      p1: [row('move uturn 2, move terastarstorm', 'U-turn→Zamazenta-Crowned + Tera Starstorm', 0.2)],
      p2: [row('move pollenpuff -2, move wideguard', 'Pollen Puff→Zamazenta-Crowned + Wide Guard', -0.05)],
    },
  },
  played: {
    p1: null, p2: null,
    p1Slots: [{ kind: 'move', name: 'U-turn', targetLoc: 2 }, { kind: 'move', name: 'Tera Starstorm', targetLoc: 2 }],
    p2Slots: [{ kind: 'move', name: 'Pollen Puff', targetLoc: -2 }, { kind: 'move', name: 'Wide Guard', targetLoc: -2 }],
  },
});

const SHAPES: [string, () => Shape][] = [['singles', singles], ['doubles', doubles]];

/** The decision part is playedOutcome - scoreBefore, the chance part scoreAfter - playedOutcome. */
const turnOf = (make: () => Shape, scoreBefore: number, playedOutcome: number, scoreAfter: number): TurnAnalysis => {
  const { result, played } = make();
  return analyzeTurn({ turn: 7, result, played, playedOutcome, scoreBefore, scoreAfter });
};

describe.each(SHAPES)('%s: the chance part must be the larger part of the swing', (_name, make) => {
  test('a residual past the band that is not the larger part leaves the turn a shift (2630685175 t7 shape, red before: chance)', () => {
    const analysis = turnOf(make, 0.9, -0.44, -0.85);
    expect(analysis.decisionDelta).toBeCloseTo(-1.34, 10);
    expect(analysis.chanceDelta).toBeCloseTo(-0.41, 10);
    expect(Math.abs(analysis.chanceDelta!)).toBeGreaterThanOrEqual(CHANCE_THRESHOLD);
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.attribution).toBe('shift');
  });

  test('a chance part larger than the decision part stays a chance swing', () => {
    expect(turnOf(make, 0.1, 0.15, -0.4).attribution).toBe('chance');
    // The residual alone moved the turn: no decision part at all.
    expect(turnOf(make, 0.25, 0.25, -0.25).attribution).toBe('chance');
  });

  test('the chance part must be the larger one, not an equal one: a tie is a shift (the swing is a band)', () => {
    const analysis = turnOf(make, 0.25, 0.5, 0.75);
    expect(analysis.decisionDelta).toBe(0.25);
    expect(analysis.chanceDelta).toBe(0.25);
    expect(analysis.attribution).toBe('shift');
  });

  test('a residual under the band is no chance swing whatever the decision part is (unchanged)', () => {
    // Decision part +0.2, chance part +0.15, swing +0.35: a shift. Both parts small: quiet.
    expect(turnOf(make, 0.25, 0.5, 0.65).attribution).toBe('shift');
    expect(turnOf(make, 0.25, 0.3, 0.4).attribution).toBe('quiet');
  });

  test('parts that cancel to a quiet swing make a quiet turn, however large each is', () => {
    const analysis = turnOf(make, 0.5, 0.125, 0.4375);
    expect(analysis.decisionDelta).toBe(-0.375);
    expect(analysis.chanceDelta).toBe(0.3125);
    expect(Math.abs(analysis.swing!)).toBeLessThan(CHANCE_THRESHOLD);
    expect(analysis.attribution).toBe('quiet');
  });

  test('a shift whose parts pull opposite ways does not claim they pushed the same way (red before: the frame said so)', () => {
    // Decision part -0.75, chance part +0.25: the choices cost more than the engine's re-read gave back.
    const opposite = turnOf(make, 0.5, -0.25, 0.0);
    expect(opposite.decisionDelta).toBe(-0.75);
    expect(opposite.chanceDelta).toBe(0.25);
    expect(opposite.attribution).toBe('shift');
    const card = summarizeTurn(opposite, names);
    expect(card).toContain('No single mistake stands out');
    expect(card).not.toContain('pushed the same way');
    // The same direction keeps the frame.
    const same = turnOf(make, 0.5, -0.25, -0.5);
    expect(same.attribution).toBe('shift');
    expect(summarizeTurn(same, names)).toContain('pushed the same way');
  });
});

describe('the shown attribution of a read that lost ground applies the same rule', () => {
  const played = row('move earthquake', 'Earthquake', 0.2);
  const side = (): SideAnalysis => ({ playedRaw: null, played, best: played, safe: played, regret: 0 });
  const turn = (over: Partial<TurnAnalysis>): TurnAnalysis => ({
    turn: 10, scoreBefore: 0, scoreAfter: 0, swing: 0, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0,
    attribution: 'p2-read', p1: side(), p2: { ...side(), riskPaidOff: true }, playedTracking: true, ...over,
  });

  test('a residual that is not the larger part shows a shift, a larger one the chance swing', () => {
    expect(shownAttribution(turn({ swing: 0.3, decisionDelta: -0.19, chanceDelta: 0.49 }))).toBe('chance');
    expect(shownAttribution(turn({ swing: 0.3, decisionDelta: 0.7, chanceDelta: -0.4 }))).toBe('shift');
  });

  test('a turn without a decision part keeps the reading of the residual alone', () => {
    expect(shownAttribution(turn({ swing: 0.3, decisionDelta: null, chanceDelta: 0.49 }))).toBe('chance');
  });
});
