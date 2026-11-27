import { test, expect, describe } from 'vitest';
import { TIER_THRESHOLDS, winDeltaText, winPctText, winPercent, type RankedChoice, type SideAnalysis } from '@fulllifegames/eval-engine';
import { comparisonTarget, ENGINE_EQUIVALENT_EPSILON, evTitle, inaccuracyView, leadGradeSize, playedTextFor, regretView, RISK_DISPLAY_GAP } from '../../src/components/eval/turn-copy';

const ranked = (label: string, ev: number, worstCase = ev - 0.2): RankedChoice =>
  ({ choice: label.toLowerCase(), label, ev, expected: ev, worstCase, punishedBy: null });
const side = (extra: Partial<SideAnalysis> = {}) => ({ riskUnpunished: false, riskPaidOff: false, ...extra }) as unknown as SideAnalysis;

describe('turn copy', () => {
  test('the constants tie the display to the engine thresholds', () => {
    expect(RISK_DISPLAY_GAP).toBe(TIER_THRESHOLDS.mistake);
    expect(ENGINE_EQUIVALENT_EPSILON).toBe(0.01);
    expect(evTitle('Alice')).toBe("Alice's win probability with this choice against balanced play; higher is better for Alice.");
  });

  test('the played text names the matched line with its win chance, else the raw or slot action, else why nothing surfaced', () => {
    expect(playedTextFor(side({ played: ranked('Earthquake', 0.3) }))).toEqual({ acted: true, playedText: expect.stringMatching(/^Earthquake \(.*%\)$/) });
    expect(playedTextFor(side({ playedRaw: { kind: 'switch', name: 'Heatran', species: 'Heatran' } as SideAnalysis['playedRaw'] })))
      .toEqual({ acted: true, playedText: "→ Heatran (not among the engine's options)" });
    expect(playedTextFor(side({ playedSlots: [{ kind: 'move', name: 'Fake Out' }, null, { kind: 'switch', name: 'Rillaboom', species: 'Rillaboom' }] as SideAnalysis['playedSlots'] })))
      .toEqual({ acted: true, playedText: "Fake Out + → Rillaboom (not among the engine's candidates)" });
    expect(playedTextFor(side({ prevented: 'flinch' }))).toEqual({ acted: false, playedText: 'flinched: the chosen action never surfaced' });
    expect(playedTextFor(side({ prevented: 'move: Taunt' })).playedText).toBe('was blocked by Taunt: the chosen action never surfaced');
    expect(playedTextFor(side({ prevented: 'faint' })).playedText).toBe('fainted before its action came out');
    expect(playedTextFor(side({ prevented: 'confusion' })).playedText).toBe('was prevented (confusion): the chosen action never surfaced');
    expect(playedTextFor(side({}))).toEqual({ acted: false, playedText: 'choice never surfaced' });
  });

  test('the comparison target is the best line, the safe line for a risk, or the null-move alternative', () => {
    const best = ranked('Earthquake', 0.4);
    const safe = ranked('Protect', 0.1, 0.05);
    expect(comparisonTarget(side({}), best)).toEqual({ asSafe: false, target: best, swapped: null, value: 0.4 });
    expect(comparisonTarget(side({ riskUnpunished: true, safe }), best)).toEqual({ asSafe: true, target: safe, swapped: null, value: 0.05 });
    expect(comparisonTarget(side({ riskPaidOff: true }), best)).toMatchObject({ asSafe: true, target: best, value: best.worstCase });
    const alternative = ranked('Stone Edge', 0.35);
    expect(comparisonTarget(side({ bestNull: { alternative } as SideAnalysis['bestNull'] }), best)).toEqual({ asSafe: false, target: best, swapped: alternative, value: 0.35 });
  });

  test.each([
    ['opening, the rounded chances part from the linear points', 0.35, 0.24, undefined, '66%', '61%', '−5%'],
    ['a fainted share of 0.5 stretches the sigmoid', 0.3, 0.18, 0.5, '72%', '64%', '−8%'],
    ['a high share where the linear points read one more', 0.6, 0.48, 0.5, '87%', '82%', '−5%'],
    ['chances and points agree', 0.35, 0.23, 0.1, '66%', '60%', '−6%'],
  ])('an inaccuracy card\'s size is the difference of its two printed chances: %s', (_scene, best, played, share, bestPct, playedPct, size) => {
    const view = inaccuracyView(side({ best: ranked('Earthquake', best), played: ranked('Stone Edge', played), faintedFraction: share, regret: best - played }));
    expect(`${winPercent(best, share)}%`).toBe(bestPct);
    expect(`${winPercent(played, share)}%`).toBe(playedPct);
    expect(view.text).toBe(size);
    expect(view.title).toContain(`regret of ${(best - played).toFixed(2)} on the score scale`);
  });

  test('an inaccuracy card without a pair of chances keeps the linear points', () => {
    expect(inaccuracyView(side({ regret: 0.12 })).text).toBe(winDeltaText(-0.12));
    expect(inaccuracyView(side({ best: ranked('Earthquake', 0.35) })).text).toBe(winDeltaText(0));
  });

  const gapText = (better: number, played: number, share?: number) => `−${winPercent(better, share) - winPercent(played, share)}%`;

  test.each([
    ['singles, opening, mistake', 'mistake', 0.35, 0.1, undefined, '66%', '55%', '−11%'],
    ['singles, opening, blunder', 'blunder', 0.35, -0.15, undefined, '66%', '43%', '−23%'],
    ['doubles, three of eight down, mistake', 'mistake', 0.3, 0.02, 0.5, '72%', '52%', '−20%'],
    ['doubles, three of eight down, blunder', 'blunder', 0.42, -0.1, 0.5, '79%', '42%', '−37%'],
  ] as const)('a %s chip is the difference of the two chances on the card, never the linear points', (_scene, tier, best, played, share, bestPct, playedPct, size) => {
    const regret = best - played;
    const view = regretView('Alice', side({ tier, best: ranked('Earthquake', best), played: ranked('Stone Edge', played), faintedFraction: share, regret }), regret);
    expect(`${winPercent(best, share)}%`).toBe(bestPct);
    expect(`${winPercent(played, share)}%`).toBe(playedPct);
    expect(view.text).toBe(size);
    expect(view.text).not.toBe(winDeltaText(-regret));
  });

  test('the chip reads the pair of the better row: a null-move alternative, a safe line, or the best', () => {
    const base = { tier: 'mistake', best: ranked('Earthquake', 0.35), played: ranked('Stone Edge', 0.1), regret: 0.25 } as const;
    expect(regretView('Alice', side(base), 0.25).text).toBe(gapText(0.35, 0.1));
    const alternative = ranked('Fire Blast', 0.3);
    expect(regretView('Alice', side({ ...base, bestNull: { alternative } as SideAnalysis['bestNull'] }), 0.25).text).toBe(gapText(0.3, 0.1));
    const safe = ranked('Protect', 0.2, 0.18);
    expect(regretView('Alice', side({ ...base, riskUnpunished: true, safe }), 0.25).text).toBe(gapText(0.18, 0.1));
    expect(regretView('Alice', side({ ...base, riskPaidOff: true, safe }), 0.25).text).toBe(gapText(0.18, 0.1));
  });

  test('a regret over 1 still names the two chances; without a pair the linear points stay', () => {
    const base = { tier: 'mistake', best: ranked('Astral Barrage', 0.92), played: ranked('Taunt', -0.767), regret: 1.687 } as const;
    expect(regretView('Alice', side(base), 1.687).text).toBe(`${winPctText(0.92)} to ${winPctText(-0.767)}`);
    expect(regretView('Alice', side({ regret: 0.25 }), 0.25).text).toBe(winDeltaText(-0.25));
    expect(regretView('Alice', side({ best: ranked('Earthquake', 0.35), regret: 0.25 }), 0.25).text).toBe(winDeltaText(-0.25));
  });

  test.each([
    ['a mistake', -0.1, -0.4],
    ['a blunder', -0.1, -0.6],
    ['an inaccuracy', -0.1, -0.15],
  ])('a lead card\'s size (%s) is the difference of the chances of its led and better lines, opening scale', (_scene, best, played) => {
    expect(leadGradeSize({ best: ranked('Lead A', best), played: ranked('Lead B', played), regret: best - played })).toBe(gapText(best, played));
    expect(leadGradeSize({ best: ranked('Lead A', best), played: null, regret: best - played })).toBe(winDeltaText(-(best - played)));
    expect(leadGradeSize({ best: null, played: ranked('Lead B', played), regret: null })).toBe(winDeltaText(0));
  });
});
