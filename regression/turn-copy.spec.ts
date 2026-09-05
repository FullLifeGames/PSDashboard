import { test, expect, describe } from 'vitest';
import { TIER_THRESHOLDS, type RankedChoice, type SideAnalysis } from '@fulllifegames/eval-engine';
import { comparisonTarget, ENGINE_EQUIVALENT_EPSILON, evTitle, playedTextFor, RISK_DISPLAY_GAP } from '../src/components/eval/turn-copy';

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
});
