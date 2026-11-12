import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 89 (T322, #59), block 2 stage 4: the strand acquittal in the grade (turn-analysis/grading.ts). The record of the strand
 * round (`EvalResult.strands`) softens a side's verdict when the regret after the searched strands lands in a softer band;
 * a record that does not, or that belongs to another pair of choices, changes nothing. Singles keys and doubles combos both.
 */

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });
const choiceEv = (choiceStr: string, label: string, worstCase: number, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev, punishedBy: 'Reply' });

const result: EvalResult = {
  score: 0.1,
  interval: 0.05,
  depthCompleted: 2,
  perSide: {
    p1: [
      choice('move dracometeor', 'Draco Meteor', 0.2),
      choice('move uturn', 'U-turn', 0.05),
      choice('switch 2', '→ Corviknight', -0.1),
    ],
    p2: [
      choice('switch 3', '→ Dragapult', -0.05),
      choice('move recover', 'Recover', -0.3),
      choice('move freezedry terastallize', 'Tera + Freeze-Dry', -0.4),
    ],
  },
};

describe('the strand acquittal', () => {
  const strandOf = (regret: number, over: Partial<NonNullable<EvalResult['strands']>['p2']> = {}): NonNullable<EvalResult['strands']>['p2'] => ({
    played: 'move recover', best: 'switch 3', playedEv: -0.3 + (0.25 - regret), bestEv: -0.05, regret, regretBefore: 0.25,
    strands: [
      { role: 'B', classKey: 'miss', chance: 0.1, column: 'Tackle', before: 0.2, searched: 0.1 },
      { role: 'P', classKey: 'hit-nokill+flinch', chance: 0.3, column: 'Iron Head', before: -0.9, searched: -0.4 },
    ],
    ...over,
  });
  const grade = (strands: EvalResult['strands'], extra: Partial<Parameters<typeof analyzeTurn>[0]> = {}) => analyzeTurn({
    turn: 20, result: { ...result, strands },
    played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
    playedOutcome: 0.0, scoreBefore: 0.1, scoreAfter: -0.25,
    ...extra,
  });

  test('a record that lowers the regret into a softer band softens the tier and names the strand with the most weight', () => {
    // No record: regret 0.25 = mistake. The searched strands bring it to 0.15 = inaccuracy.
    expect(grade(undefined).p2.tier).toBe('mistake');
    const analysis = grade({ p2: strandOf(0.15) });
    expect(analysis.p2.tier).toBe('inaccuracy');
    expect(analysis.p2.regret).toBeCloseTo(0.25, 10); // the regret stays the engine's; only the verdict softens
    expect(analysis.p2.strand).toEqual({ role: 'P', classKey: 'hit-nokill+flinch', chance: 0.3, column: 'Iron Head', tier: 'inaccuracy', from: 'mistake' });
  });

  test('a record that clears the band leaves no tier and says so', () => {
    const analysis = grade({ p2: strandOf(0.05) });
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.strand?.tier).toBe('none');
  });

  test('a record that keeps or raises the regret changes nothing and leaves no strand', () => {
    for (const regret of [0.25, 0.3, 0.45]) {
      const analysis = grade({ p2: strandOf(regret) });
      expect(analysis.p2.tier).toBe('mistake');
      expect(analysis.p2.strand).toBeUndefined();
    }
    // A lower regret inside the same band is no softening either.
    const same = grade({ p2: strandOf(0.21) });
    expect(same.p2.tier).toBe('mistake');
    expect(same.p2.strand).toBeUndefined();
  });

  test('a record of another pair than the grade\'s own played and best choices is ignored', () => {
    expect(grade({ p2: strandOf(0.05, { played: 'move freezedry terastallize' }) }).p2.tier).toBe('mistake');
    expect(grade({ p2: strandOf(0.05, { best: 'move recover' }) }).p2.tier).toBe('mistake');
    // The other side's record does not leak across.
    const analysis = grade({ p1: strandOf(0.05) });
    expect(analysis.p2.tier).toBe('mistake');
    expect(analysis.p2.strand).toBeUndefined();
  });

  test('a decided position demotes the record\'s regret like the plain one: the softer tier wins', () => {
    // p2 is 0.8 behind: regret 0.25 = mistake, one softer = inaccuracy; the record's 0.15 = inaccuracy, one softer = none.
    expect(grade(undefined, { scoreBefore: 0.8 }).p2.tier).toBe('inaccuracy');
    const analysis = grade({ p2: strandOf(0.15) }, { scoreBefore: 0.8 });
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.strand?.tier).toBe('none');
    // A record whose regret lands in the same decided band (0.25 to 0.22) softens nothing.
    const flat = grade({ p2: strandOf(0.22) }, { scoreBefore: 0.8 });
    expect(flat.p2.tier).toBe('inaccuracy');
    expect(flat.p2.strand).toBeUndefined();
  });

  test('the item-sensitivity probe still acts after a strand softening', () => {
    const analysis = grade({ p2: strandOf(0.15) }, {
      sensitivity: { p2: [{ species: 'Heatran', item: 'Leftovers', playedEv: -0.06, bestEv: -0.05 }] },
    });
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.strand?.tier).toBe('inaccuracy');
    expect(analysis.p2.sensitivity?.species).toBe('Heatran');
  });

  test('doubles: the record matches the played combo of the slots', () => {
    const doublesResult: EvalResult = {
      score: 0, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice('move tackle 1, move protect', 'Tackle + Protect', 0.1)],
        p2: [
          choiceEv('move protect, move drainpunch 1', 'Protect + Drain Punch', 0.05, 0.05),
          choiceEv('move rockslide, move drainpunch 1', 'Rock Slide + Drain Punch', -0.3, -0.3),
        ],
      },
    };
    const params = (strands: EvalResult['strands']) => ({
      turn: 5, result: { ...doublesResult, strands },
      played: {
        p1: null, p2: null,
        p1Slots: [{ kind: 'move' as const, name: 'Tackle', targetLoc: 1 }, { kind: 'move' as const, name: 'Protect', targetLoc: null }],
        p2Slots: [{ kind: 'move' as const, name: 'Rock Slide', targetLoc: null }, { kind: 'move' as const, name: 'Drain Punch', targetLoc: 1 }],
      },
      playedOutcome: null, scoreBefore: 0, scoreAfter: null,
    });
    const record = (regret: number, played = 'move rockslide, move drainpunch 1') => ({
      p2: {
        played, best: 'move protect, move drainpunch 1', playedEv: 0.05 - regret, bestEv: 0.05, regret, regretBefore: 0.35,
        strands: [{ role: 'P' as const, classKey: 'p2a:rockslide>p1a=hit-nokill+flinch', chance: 0.3, column: 'Tackle + Protect', before: -0.9, searched: -0.2 }],
      },
    });
    expect(analyzeTurn(params(undefined)).p2.tier).toBe('mistake');
    const softened = analyzeTurn(params(record(0.15)));
    expect(softened.p2.tier).toBe('inaccuracy');
    expect(softened.p2.strand?.classKey).toBe('p2a:rockslide>p1a=hit-nokill+flinch');
    expect(analyzeTurn(params(record(0.15, 'move protect, move rockslide'))).p2.tier).toBe('mistake');
  });
});
