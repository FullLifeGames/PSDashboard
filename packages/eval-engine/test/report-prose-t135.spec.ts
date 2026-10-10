import { test, expect, describe } from 'vitest';
import type { SideAnalysis } from '../src/analysis';
import { phrase } from '../src/prose/phrases';
import { inaccuracyClause, sideClause } from '../src/prose/clauses';
import { seedPhrase } from '../src/win-reason';
import type { RankedChoice } from '../src/types';

/**
 * Round 67 (T135, the report rests of round 64). Point 2: phrase() rewrote
 * only a leading "→ X" of the whole label, so a doubles pair read as one
 * switch ("safer was switching to Ting-Lu + Scale Shot→Incineroar",
 * 2663093831 t7) or kept a raw arrow ("Parting Shot→Orthworm + → Volcanion
 * was slightly better"). A pair now reads per slot in the gerund, the shape
 * of playedVerb; a single label keeps its form (the singles pins
 * "switching to Heatran" and "switching to Lopunny-Mega came instead").
 */

const ranked = (choice: string, label: string, ev: number): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

describe('T135 point 2: a doubles pair reads per slot in the gerund templates', () => {
  test('a pair with a switch reads per slot in the gerund, slots of one kind share the verb, a gimmick stays with its move', () => {
    expect(phrase('→ Ting-Lu + Scale Shot→Incineroar')).toBe('switching to Ting-Lu and playing Scale Shot→Incineroar');
    expect(phrase('Parting Shot→Orthworm + → Volcanion')).toBe('playing Parting Shot→Orthworm and switching to Volcanion');
    expect(phrase('→ Calyrex-Shadow + → Chi-Yu')).toBe('switching to Calyrex-Shadow and Chi-Yu');
    expect(phrase('Tera + Heat Wave + → Incineroar')).toBe('playing Tera + Heat Wave and switching to Incineroar');
  });

  test('singles labels and pairs of moves keep their form', () => {
    expect(phrase('→ Heatran')).toBe('switching to Heatran');
    expect(phrase('Close Combat')).toBe('Close Combat');
    expect(phrase('Tera + Heat Wave')).toBe('Tera + Heat Wave');
    expect(phrase('Tailwind + Solar Beam→Groudon')).toBe('Tailwind + Solar Beam→Groudon');
  });

  test('2663093831 t7 shape: the misplay, the inaccuracy and the report seed read the pairs per slot', () => {
    const misplay = side({
      played: ranked('move irondefense, move protect', 'Iron Defense + Protect', -0.1),
      best: ranked('switch 3, move scaleshot 2', '→ Ting-Lu + Scale Shot→Incineroar', 0.3), regret: 0.4, tier: 'mistake',
    });
    const clause = sideClause('komeiji5', misplay, side({})) ?? '';
    expect(clause).toContain('safer was switching to Ting-Lu and playing Scale Shot→Incineroar');
    expect(clause).not.toContain('switching to Ting-Lu + ');
    const inaccurate = side({
      played: ranked('move partingshot 1, switch 4', 'Parting Shot→Orthworm + → Volcanion', 0.1),
      best: ranked('move partingshot 1, move protect', 'Parting Shot→Orthworm + Protect', 0.22), regret: 0.12, tier: 'inaccuracy',
    });
    expect(inaccuracyClause('herq', inaccurate)).toContain("herq's playing Parting Shot→Orthworm and switching to Volcanion was an inaccuracy");
    expect(inaccuracyClause('herq', inaccurate)).not.toContain('+ →');
    const seed = seedPhrase({
      turn: 7, scoreBefore: 0, scoreAfter: -0.3, swing: -0.3, playedOutcome: -0.2, decisionDelta: -0.2, chanceDelta: -0.1,
      attribution: 'p1-decision', p1: misplay, p2: side({}),
    }, 'p1');
    expect(seed).toContain('safer was switching to Ting-Lu and playing Scale Shot→Incineroar');
  });
});
