import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { logRules } from '@fulllifegames/replay-core';
import { detectSacks } from '../src/played';
import { sackClause, inaccuracyClause, readCreditClause, sideClause, forcedClause } from '../src/prose/clauses';
import type { SideAnalysis } from '../src/analysis';
import type { RankedChoice } from '../src/types';
import { phrase } from '../src/prose/phrases';
import { seedPhrase } from '../src/win-reason';

const mon = (name: string, speciesForme: string, hpPercent: number, isActive: boolean) => ({
  name, speciesForme, hp: hpPercent, maxhp: 100, hpPercent,
  status: '', fainted: false, isActive, boosts: {}, moves: [],
  ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const snapshot = (p1: ReturnType<typeof mon>[], p2: ReturnType<typeof mon>[]): TurnSnapshot => ({
  turn: 1,
  p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: p1 },
  p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: p2 },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
});

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

describe('a sack names the other bodies the side lost on the turn', () => {
  test('doubles (912045 t1 shape): Ogerpon fed at 9%, Rillaboom fell to the same spread move', () => {
    const events = [
      '|move|p1b: Gholdengo|Make It Rain|p2a: Ogerpon|[spread] p2a,p2b',
      '|-damage|p2a: Ogerpon|0 fnt',
      '|-damage|p2b: Rillaboom|0 fnt',
      '|faint|p2a: Ogerpon',
      '|faint|p2b: Rillaboom',
    ];
    const before = snapshot(
      [mon('Gholdengo', 'Gholdengo', 100, true)],
      [mon('Ogerpon', 'Ogerpon-Cornerstone', 9, true), mon('Rillaboom', 'Rillaboom', 78, true)],
    );
    expect(detectSacks(events, before, logRules('')).p2).toEqual({
      name: 'Ogerpon', species: 'Ogerpon-Cornerstone', hpFraction: 0.09, alsoFell: ['Rillaboom'],
      others: [{ name: 'Rillaboom', species: 'Rillaboom', hpFraction: 0.78, stayed: true }],
    });
  });

  test('singles (653785 t26 shape): the replacement the hazards took after the fed body is named', () => {
    const events = [
      '|move|p2a: Dragonite|Dragon Claw|p1a: Tornadus',
      '|-damage|p1a: Tornadus|0 fnt',
      '|faint|p1a: Tornadus',
      '|switch|p1a: Volcanion|Volcanion|109/363',
      '|-damage|p1a: Volcanion|0 fnt|[from] Spikes',
      '|faint|p1a: Volcanion',
    ];
    const before = snapshot(
      [mon('Tornadus', 'Tornadus-Therian', 10, true), mon('Volcanion', 'Volcanion', 30, false)],
      [mon('Dragonite', 'Dragonite', 100, true)],
    );
    expect(detectSacks(events, before, logRules('')).p1).toEqual({
      name: 'Tornadus', species: 'Tornadus-Therian', hpFraction: 0.1, alsoFell: ['Volcanion'],
      others: [{ name: 'Volcanion', species: 'Volcanion', hpFraction: 109 / 363, healthy: true }],
    });
  });

  test('the sack sentence names them; a one-body sack (573756 t68) says nothing more', () => {
    expect(sackClause('Alpha', side({ sacrifice: { name: 'Ogerpon', hpFraction: 0.09, alsoFell: ['Rillaboom'] } })))
      .toContain('a low-cost trade, not graded as a misplay. Alpha also lost Rillaboom on this turn.');
    const single = sackClause('Alpha', side({ sacrifice: { name: 'T-34-85', hpFraction: 0.77, stayed: true, verified: true } }));
    expect(single).not.toContain('also lost');
    expect(single).toContain('verified as a win-condition sacrifice');
  });
});

const choice = (choiceStr: string, label: string, ev: number, worstCase = ev): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: ev, ev, punishedBy: 'Reply' });

const quiet = side({});

describe('every clause on a partial side names the hidden slot', () => {
  test('the read credit (2629703929 t1 shape) says it credits the visible slot', () => {
    const played = choice('move tailwind, move solarbeam 1', 'Tailwind + Solar Beam→Groudon', 0.4, -0.2);
    const safe = choice('move tailwind terastallize, move solarbeam 1', 'Tera + Tailwind + Solar Beam→Groudon', 0.3, -0.1);
    const credit = { played, best: safe, safe, regret: 0.05, readCredit: { payoff: 0.6 } };
    expect(readCreditClause('Alpha', side({ ...credit, playedPartial: true }), null))
      .toMatch(/\(Partner's action hidden; credited on the visible slot\.\)$/);
    expect(readCreditClause('Alpha', side(credit), null)).not.toContain('hidden');
  });

  test('the inaccuracy (2630685175 t5 shape) and the verdict clause say they grade the visible slot, without a dash', () => {
    const played = choice('move protect, move bodypress 1', 'Protect + Body Press→Calyrex-Ice', 0.1);
    const best = choice('move astralbarrage, move bodypress 1', 'Astral Barrage + Body Press→Calyrex-Ice', 0.25);
    expect(inaccuracyClause('Alpha', side({ played, best, safe: best, regret: 0.15, tier: 'inaccuracy', playedPartial: true })))
      .toMatch(/\(Partner's action hidden; graded on the visible slot\.\)$/);
    expect(sideClause('Alpha', side({ played, best, safe: best, regret: 0.25, tier: 'mistake', playedPartial: true }), quiet))
      .toMatch(/\(Partner's action hidden; graded on the visible slot\.\)$/);
  });

  test('guard: the sack clause stays without the note (the hidden slot is the fed body itself)', () => {
    const sack = sackClause('Alpha', side({ playedPartial: true, sacrifice: { name: 'TeraTurtle', hpFraction: 0.5, stayed: true, verified: true } }));
    expect(sack).not.toContain('hidden');
  });
});

describe('the read template reads as English', () => {
  test('singles paid-off read (653785 t25 shape): "switched to", "the safe switch to"', () => {
    const played = choice('switch 4', '→ Cofagrigus', 0.3, -0.1);
    const safe = choice('switch 5', '→ Volcanion', 0.2, 0.0);
    const clause = sideClause('Alpha', side({ played, best: safe, safe, regret: 0.25, tier: 'mistake', riskPaidOff: true, riskPayoff: 0.3 }), quiet);
    expect(clause).toContain('Alpha switched to Cofagrigus: a read that paid off, +15% over the safe switch to Volcanion (50% guaranteed).');
    expect(clause).not.toContain('switching to');
  });

  test('singles read credit (649664 t2 shape): the switch is a verb, a move stays a noun', () => {
    const played = choice('switch 3', '→ Keldeo', 0.1, -0.3);
    const safe = choice('move hurricane', 'Hurricane', 0.05, -0.2);
    const clause = readCreditClause('Alpha', side({ played, best: safe, safe, regret: 0.05, readCredit: { payoff: 0.35, payoffTurn: 1 } }), null);
    expect(clause).toContain('Alpha switched to Keldeo, a read the engine gave no weight: one turn later, before the rolls, it stood +18% over the safe Hurricane');
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
    expect(unpunished).toContain('Alpha switched to Cofagrigus as a read:');
    expect(unpunished).toContain("The engine's safe line was switching to Volcanion");
  });

  test('doubles paid-off read (2629703929 t4 shape): each slot gets its verb, the safe pair its nouns', () => {
    const played = choice('switch 3, move protect', '→ Calyrex-Shadow + Protect', 0.3, -0.1);
    const safe = choice('switch 4, move collisioncourse 1', '→ Chi-Yu + Collision Course→Chien-Pao', 0.2, -0.2);
    const clause = sideClause('Alpha', side({ played, best: safe, safe, regret: 0.25, tier: 'mistake', riskPaidOff: true, riskPayoff: 0.34 }), quiet);
    expect(clause).toContain('Alpha switched to Calyrex-Shadow and played Protect: a read that paid off, +17% over the safe switch to Chi-Yu and Collision Course→Chien-Pao');
  });

  test('doubles: a switch in the second slot (2663093831 t2) and a Tera slot keep one slot each', () => {
    const played = choice('move heatwave, switch 4', 'Heat Wave + → Incineroar', 0.2, -0.1);
    const safe = choice('move heatwave terastallize, move spikyshield', 'Tera + Heat Wave + Spiky Shield', 0.1, 0.05);
    const clause = sideClause('Alpha', side({ played, best: safe, safe, regret: 0.25, tier: 'mistake', riskPaidOff: true, riskPayoff: 0.14 }), quiet);
    expect(clause).toContain('Alpha played Heat Wave and switched to Incineroar: a read that paid off, +7% over the safe Tera + Heat Wave and Spiky Shield');
  });

  test('guard: a gerund in subject position stays (the 648453 t13 pin "switching to Lopunny-Mega came instead")', () => {
    const forced = forcedClause('Alpha', side({
      played: choice('switch 6', '→ Lopunny-Mega', 0), forcedMix: { label: '→ Bisharp', weight: 0.95 },
    }));
    expect(forced).toBe('The equilibrium all but commits Alpha to switching to Bisharp here (95%), but switching to Lopunny-Mega came instead.');
  });
});

const ranked = (choice: string, label: string, ev: number): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });

describe('a doubles pair reads per slot in the gerund templates', () => {
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
