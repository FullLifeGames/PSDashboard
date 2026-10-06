import { test, expect, describe } from 'vitest';
import type { SideAnalysis } from '../src/analysis';
import { readCreditClause, sideClause, forcedClause } from '../src/prose/clauses';
import type { RankedChoice } from '../src/types';

/**
 * Round 64 (T123 point 1): the read template put a gerund where English
 * wants a verb or a noun ("BKC played switching to Keldeo", "over the safe
 * switching to Volcanion"), and a doubles pair turned its first slot into
 * the gerund ("switching to Calyrex-Shadow + Protect") while a later switch
 * kept its arrow ("Heat Wave + → Incineroar").
 */

const choice = (choiceStr: string, label: string, ev: number, worstCase = ev): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: ev, ev, punishedBy: 'Reply' });

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

const quiet = side({});

describe('point 1: the read template reads as English', () => {
  test('singles paid-off read (653785 t25 shape): "switched to", "the safe switch to"', () => {
    const played = choice('switch 4', '→ Cofagrigus', 0.3, -0.1);
    const safe = choice('switch 5', '→ Volcanion', 0.2, 0.0);
    const clause = sideClause('Alpha', side({ played, best: safe, safe, regret: 0.25, tier: 'mistake', riskPaidOff: true, riskPayoff: 0.3 }), quiet);
    expect(clause).toContain('Alpha switched to Cofagrigus — a read that paid off, +15% over the safe switch to Volcanion (50% guaranteed).');
    expect(clause).not.toContain('switching to');
  });

  test('singles read credit (649664 t2 shape): the switch is a verb, a move stays a noun', () => {
    const played = choice('switch 3', '→ Keldeo', 0.1, -0.3);
    const safe = choice('move hurricane', 'Hurricane', 0.05, -0.2);
    const clause = readCreditClause('Alpha', side({ played, best: safe, safe, regret: 0.05, readCredit: { payoff: 0.35, payoffTurn: 1 } }), null);
    expect(clause).toContain('Alpha switched to Keldeo — a read the engine gave no weight: one turn later, before the rolls, it stood +18% over the safe Hurricane');
  });

  test('singles punished misplay (655336 t22 shape) and unpunished read: "switched to", the gerund stays where English takes it', () => {
    const played = choice('switch 2', '→ Dragonite', 0.1);
    const best = choice('move uturn', 'U-turn', 0.4);
    expect(sideClause('Alpha', side({ played, best, safe: best, regret: 0.3, tier: 'mistake' }), quiet))
      .toContain('Alpha switched to Dragonite (55%); safer was U-turn (68%)');
    const safe = choice('switch 5', '→ Volcanion', 0.2, 0.1);
    const risky = choice('switch 4', '→ Cofagrigus', 0.0, -0.4);
    const unpunished = sideClause('Alpha', side({
      played: risky, best: safe, safe, regret: 0.2, tier: 'mistake', riskUnpunished: true,
    }), side({ played: choice('move flamethrower', 'Flamethrower', 0) }));
    expect(unpunished).toContain('Alpha switched to Cofagrigus — a read:');
    expect(unpunished).toContain("The engine's safe line was switching to Volcanion");
  });

  test('doubles paid-off read (2629703929 t4 shape): each slot gets its verb, the safe pair its nouns', () => {
    const played = choice('switch 3, move protect', '→ Calyrex-Shadow + Protect', 0.3, -0.1);
    const safe = choice('switch 4, move collisioncourse 1', '→ Chi-Yu + Collision Course→Chien-Pao', 0.2, -0.2);
    const clause = sideClause('Alpha', side({ played, best: safe, safe, regret: 0.25, tier: 'mistake', riskPaidOff: true, riskPayoff: 0.34 }), quiet);
    expect(clause).toContain('Alpha switched to Calyrex-Shadow and played Protect — a read that paid off, +17% over the safe switch to Chi-Yu and Collision Course→Chien-Pao');
  });

  test('doubles: a switch in the second slot (2663093831 t2) and a Tera slot keep one slot each', () => {
    const played = choice('move heatwave, switch 4', 'Heat Wave + → Incineroar', 0.2, -0.1);
    const safe = choice('move heatwave terastallize, move spikyshield', 'Tera + Heat Wave + Spiky Shield', 0.1, 0.05);
    const clause = sideClause('Alpha', side({ played, best: safe, safe, regret: 0.25, tier: 'mistake', riskPaidOff: true, riskPayoff: 0.14 }), quiet);
    expect(clause).toContain('Alpha played Heat Wave and switched to Incineroar — a read that paid off, +7% over the safe Tera + Heat Wave and Spiky Shield');
  });

  test('guard: a gerund in subject position stays (the 648453 t13 pin "switching to Lopunny-Mega came instead")', () => {
    const forced = forcedClause('Alpha', side({
      played: choice('switch 6', '→ Lopunny-Mega', 0), forcedMix: { label: '→ Bisharp', weight: 0.95 },
    }));
    expect(forced).toBe('The equilibrium all but commits Alpha to switching to Bisharp here (95%) — switching to Lopunny-Mega came instead.');
  });
});
