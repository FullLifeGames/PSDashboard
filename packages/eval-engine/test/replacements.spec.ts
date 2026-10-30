import { describe, expect, test } from 'vitest';
import { TIER_THRESHOLDS } from '../src/analysis';
import { analyzeReplacements, matchReplacementOption, replacementSpeciesOf, type ReplacementEvalData } from '../src/replacements';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 79 (T290): the unit of the replacement note. The played pick is found in the engine's ranked list by species (doubles: as
 * a set over the forced slots), the regret is read off the list, and nothing is graded: the record carries no tier.
 */

const option = (label: string, ev: number, choice = label): RankedChoice =>
  ({ choice, label, worstCase: ev - 0.1, expected: ev, ev, punishedBy: null });

const resultOf = (p1: RankedChoice[], p2: RankedChoice[]) => ({ score: 0, interval: 0, depthCompleted: 1, perSide: { p1, p2 } }) as unknown as EvalResult;
const WAIT = [option('(waiting)', 0, 'wait')];

const singles = (played: string[], options: RankedChoice[]): ReplacementEvalData => ({
  turn: 12, ordinal: 0, result: resultOf(options, WAIT), forced: { p1: [0], p2: [] }, played: { p1: played, p2: [] },
});

describe('analyzeReplacements: singles', () => {
  const ranked = [option('→ Zapdos-Galar', 0.47), option('→ Corviknight', 0.41), option('→ Toxapex', 0.2), option('→ Clefable', 0.1)];

  test('the played pick is found, the engine\'s pick is the first row, the regret is the gap', () => {
    const side = analyzeReplacements(singles(['Toxapex'], ranked)).p1!;
    expect(side.played?.label).toBe('→ Toxapex');
    expect(side.best?.label).toBe('→ Zapdos-Galar');
    expect(side.regret).toBeCloseTo(0.27, 10);
    expect(side.agrees).toBe(false);
    expect(side.onlyChoice).toBe(false);
    expect(side.slots).toBe(1);
    expect(side.options.map(entry => entry.label)).toEqual(['→ Zapdos-Galar', '→ Corviknight', '→ Toxapex']);
  });

  test('the engine\'s own pick agrees with a regret of 0', () => {
    const side = analyzeReplacements(singles(['Zapdos-Galar'], ranked)).p1!;
    expect(side.regret).toBe(0);
    expect(side.agrees).toBe(true);
  });

  test('a pick that trails by less than the inaccuracy bar agrees, one past the bar does not', () => {
    const bar = TIER_THRESHOLDS.inaccuracy;
    const below = analyzeReplacements(singles(['Corviknight'], [option('→ Zapdos-Galar', 0.5), option('→ Corviknight', 0.5 - bar + 0.001)])).p1!;
    expect(below.agrees).toBe(true);
    const at = analyzeReplacements(singles(['Corviknight'], [option('→ Zapdos-Galar', 0.5), option('→ Corviknight', 0.5 - bar - 0.001)])).p1!;
    expect(at.regret).toBeGreaterThanOrEqual(bar);
    expect(at.agrees).toBe(false);
  });

  test('a pick no option names leaves played and regret empty, and never agrees', () => {
    const side = analyzeReplacements(singles(['Dragapult'], ranked)).p1!;
    expect(side.played).toBeNull();
    expect(side.regret).toBeNull();
    expect(side.agrees).toBe(false);
    expect(side.best?.label).toBe('→ Zapdos-Galar');
  });

  test('a body that returns as its mega forme meets its set\'s species by the base name', () => {
    expect(matchReplacementOption([option('→ Mawile'), option('→ Zapdos')], ['Mawile-Mega'])?.label).toBe('→ Mawile');
    expect(matchReplacementOption([option('→ Landorus-Therian'), option('→ Landorus')], ['Landorus'])?.label).toBe('→ Landorus');
  });

  test('one body to send in is no choice', () => {
    const side = analyzeReplacements(singles(['Corviknight'], [option('→ Corviknight', 0.3)])).p1!;
    expect(side.onlyChoice).toBe(true);
    expect(side.agrees).toBe(true);
  });

  test('the waiting side has no record, and a forced side with no options has none to match', () => {
    const analysis = analyzeReplacements(singles(['Toxapex'], ranked));
    expect(analysis.p2).toBeNull();
    expect(analyzeReplacements(singles(['Toxapex'], [])).p1?.played).toBeNull();
  });
});

describe('analyzeReplacements: doubles', () => {
  const one = (played: string[]): ReplacementEvalData => ({
    turn: 7, ordinal: 1,
    result: resultOf(WAIT, [option('→ Ting-Lu', 0.6, 'switch 5'), option('→ Rotom-Wash', 0.5, 'switch 4')]),
    forced: { p1: [], p2: [1] }, played: { p1: [], p2: played },
  });

  test('one slot of two: the record names the turn, the ordinal and the replacing side only', () => {
    const analysis = analyzeReplacements(one(['Rotom-Wash']));
    expect([analysis.turn, analysis.ordinal, analysis.p1]).toEqual([7, 1, null]);
    expect(analysis.p2?.slots).toBe(1);
    expect(analysis.p2?.played?.label).toBe('→ Rotom-Wash');
    expect(analysis.p2?.regret).toBeCloseTo(0.1, 10);
  });

  const both = (played: string[], options: RankedChoice[]): ReplacementEvalData => ({
    turn: 9, ordinal: 0, result: resultOf(options, WAIT), forced: { p1: [0, 1], p2: [] }, played: { p1: played, p2: [] },
  });

  test('two slots: the log\'s order meets the slot order of the labels as a set', () => {
    const options = [option('→ Garchomp + → Rotom', 0.55, 'switch 3, switch 4'), option('→ Rotom + → Garchomp', 0.5, 'switch 4, switch 3'), option('→ Garchomp + → Kingambit', 0.3)];
    const side = analyzeReplacements(both(['Rotom', 'Garchomp'], options)).p1!;
    expect(side.slots).toBe(2);
    expect(side.played?.label).toBe('→ Garchomp + → Rotom');
    expect(side.agrees).toBe(true);
    const other = analyzeReplacements(both(['Garchomp', 'Kingambit'], options)).p1!;
    expect(other.played?.label).toBe('→ Garchomp + → Kingambit');
    expect(other.regret).toBeCloseTo(0.25, 10);
  });

  test('two slots, one body left: either slot is the same single choice, equal values or not, and the first row matches', () => {
    const options = [option('→ Garchomp + pass', 0.9, 'switch 3, pass'), option('pass + → Garchomp', 0.9, 'pass, switch 3')];
    expect(replacementSpeciesOf(options[0].label)).toEqual(['Garchomp']);
    const side = analyzeReplacements(both(['Garchomp'], options)).p1!;
    expect(side.onlyChoice).toBe(true);
    expect(side.played?.choice).toBe('switch 3, pass');
    expect(side.regret).toBe(0);
  });

  test('both sides at once: each side reads its own list', () => {
    const data: ReplacementEvalData = {
      turn: 4, ordinal: 0,
      result: resultOf([option('→ A', 0.5), option('→ B', 0.4)], [option('→ C', 0.6), option('→ D', 0.2)]),
      forced: { p1: [0], p2: [0] }, played: { p1: ['B'], p2: ['C'] },
    };
    const analysis = analyzeReplacements(data);
    expect(analysis.p1?.regret).toBeCloseTo(0.1, 10);
    expect(analysis.p2?.regret).toBe(0);
  });

  test('the record carries nothing graded', () => {
    const analysis = analyzeReplacements(one(['Rotom-Wash']));
    expect(Object.keys(analysis.p2!)).not.toContain('tier');
  });
});
