import { test, expect } from '@playwright/test';
import { summaryLines, type SummarySample } from './calibration-summary';

const sample = (over: Partial<SummarySample>): SummarySample => ({
  id: 'x', turn: 2, phase: 'early', gameType: 'singles', score: 0.3, faintedFraction: 0, p1Won: true,
  quality: 'std', luckAgainstFavored: false, ...over,
});

test.describe('calibration summary lines (round 34)', () => {
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
  test('without hq samples the hq line is omitted and the luck line still prints', () => {
    const lines = summaryLines([sample({}), sample({ id: 'b', gameType: 'doubles' })]);
    expect(lines.some(line => line.startsWith('hq:'))).toBe(false);
    expect(lines.some(line => line.startsWith('luck-adjusted: n=2 excluded=0'))).toBe(true);
  });
});
