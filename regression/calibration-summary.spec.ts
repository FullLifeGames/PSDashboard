import { test, expect, describe } from 'vitest';
import { summaryLines, type SummarySample } from './calibration-summary';

const sample = (over: Partial<SummarySample>): SummarySample => ({
  id: 'x', turn: 2, phase: 'early', gameType: 'singles', score: 0.3, faintedFraction: 0, p1Won: true,
  quality: 'std', luckAgainstFavored: false, ...over,
});

describe('calibration summary lines (round 34)', () => {
  test('prints the hq and luck-adjusted lines after the phase briers', () => {
    const samples = [
      sample({ id: 'a', quality: 'hq' }),
      sample({ id: 'b', score: -0.5, p1Won: false, phase: 'late', quality: 'hq' }),
      sample({ id: 'c', score: 0.2, p1Won: false, luckAgainstFavored: true }),
      sample({ id: 'd', score: 0.6, phase: 'mid' }),
    ];
    const lines = summaryLines(samples);
    const hq = lines.find(line => line.startsWith('hq:'));
    const luck = lines.find(line => line.startsWith('luck-adjusted:'));
    expect(hq).toMatch(/^hq: n=2 sign-accuracy=100% brier early\/mid\/late=\d\.\d{4}\/-\/\d\.\d{4}$/);
    expect(luck).toMatch(/^luck-adjusted: n=3 excluded=1 brier early\/mid\/late=\d\.\d{4}\/\d\.\d{4}\/\d\.\d{4}$/);
    expect(lines.indexOf(hq!)).toBeGreaterThan(lines.findIndex(line => line.startsWith('late brier=')));
    expect(lines[lines.length - 1]).toMatch(/^\|score\| /);
  });
  test('the decided line counts the named side, raw and held by the bar (round 50)', () => {
    const lines = summaryLines([
      sample({ id: 'a', score: 0.8, decided: 'p1', decidedHeld: 'p1' }),
      sample({ id: 'b', score: 0.2, p1Won: false, decided: 'p1', decidedHeld: null }),
      sample({ id: 'c', score: -0.9, p1Won: false, decided: 'p2', decidedHeld: 'p2' }),
      sample({ id: 'd', score: 0.4, decided: null, decidedHeld: null }),
    ]);
    expect(lines[lines.length - 1]).toBe('decided: n=3 named-side-wins=66.7% | held by the bar: n=2 named-side-wins=100.0%');
  });
  test('without a decided sample the decided line is omitted', () => {
    expect(summaryLines([sample({})]).some(line => line.startsWith('decided:'))).toBe(false);
  });
  test('without hq samples the hq line is omitted and the luck line still prints', () => {
    const lines = summaryLines([sample({}), sample({ id: 'b', gameType: 'doubles' })]);
    expect(lines.some(line => line.startsWith('hq:'))).toBe(false);
    expect(lines.some(line => line.startsWith('luck-adjusted: n=2 excluded=0'))).toBe(true);
  });
});
