import { test, expect, describe } from 'vitest';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { buildGameReport } from '../src/report';
import type { SackInfo } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

const names: [string, string] = ['Alpha', 'Beta'];

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number, punishedBy: string | null): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy });

/**
 * Round 63 (T17, decision 17): praise without a verdict band. Only sides
 * the regret leaves untiered get the new forms; every tiered turn keeps
 * today's sack logic to the letter.
 */
describe('the stayed feed without a band (573756 t68)', () => {
  /** p2 leaves Weavile in to die to Body Press: the floor it priced is what came, and the sweep follows. */
  const t68 = (overrides: Partial<AnalyzeTurnParams> = {}, sack: SackInfo = { name: 'Weavile', hpFraction: 0.6, stayed: true }) => {
    const result: EvalResult = {
      score: 0.183, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [ranked('move bodypress', 'Body Press', 0.359, 0.4, 0.178, 'Knock Off')],
        p2: [
          ranked('switch 3', '→ Toxapex', -0.156, 0.0, -0.149, 'Body Press'),
          ranked('move knockoff', 'Knock Off', -0.359, 0.08, -0.178, 'Body Press'),
        ],
      },
    };
    return analyzeTurn({
      turn: 68, result,
      played: { p1: { kind: 'move', name: 'Body Press' }, p2: { kind: 'move', name: 'Knock Off' } },
      playedOutcome: 0.448, futureOutcomes: [0.326, 0.242, -0.389],
      scoreBefore: 0.183, scoreAfter: 0.282,
      sacks: { p2: sack },
      ...overrides,
    });
  };

  test('the untiered feed whose floor came and whose window repaid it is stamped and spoken', () => {
    const analysis = t68();
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.sacrifice).toEqual({ name: 'Weavile', hpFraction: 0.6, stayed: true, verified: true });
    expect(summarizeTurn(analysis, names)).toContain('Beta fed Weavile (60% HP)');
    // The verdict fields stay as they were: no band, no risk credit, the same attribution.
    expect(analysis.p2.riskPaidOff).toBeUndefined();
    expect(analysis.attribution).toBe('quiet');
  });

  test('a feed above its priced floor (the rolls helped) is no verified sacrifice', () => {
    expect(t68({ playedOutcome: 0.2, futureOutcomes: [0.326, 0.242, -0.389] }).p2.sacrifice).toBeUndefined();
  });

  test('an already-lost position earns no praise (the gamble credit\'s bound)', () => {
    expect(t68({ scoreBefore: 0.75 }).p2.sacrifice).toBeUndefined();
  });

  test('untiered low-HP and healthy faints stay unstamped: those shapes are leniencies, not praise', () => {
    expect(t68({}, { name: 'Weavile', hpFraction: 0.1 }).p2.sacrifice).toBeUndefined();
    expect(t68({}, { name: 'Weavile', hpFraction: 0.6, healthy: true }).p2.sacrifice).toBeUndefined();
  });
});

describe('the hazard sack without a band (653785 t19)', () => {
  /** p1 switches a 22% Weavile into the rocks; it falls before Charizard's Flare Blitz, which hits nothing. */
  const t19 = (overrides: Partial<AnalyzeTurnParams> = {}) => {
    const result: EvalResult = {
      score: -0.045, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          ranked('move painsplit', 'Pain Split', -0.3, 0.0, -0.082, 'Mega + Flare Blitz'),
          ranked('switch 5', '→ Tornadus-Therian', -0.106, 0.0, -0.09, 'Mega + Roost'),
          ranked('switch 4', '→ Weavile', -0.22, 0.0, -0.0839, 'Mega + Roost'),
        ],
        p2: [ranked('move flareblitz mega', 'Mega + Flare Blitz', 0.0, 0.0, 0.08, 'Pain Split')],
      },
    };
    return analyzeTurn({
      turn: 19, result,
      played: { p1: { kind: 'switch', name: 'Weavile', species: 'Weavile' }, p2: { kind: 'move', name: 'Flare Blitz', mega: true } },
      playedOutcome: 0.23, futureOutcomes: [0.395, 0.547],
      scoreBefore: -0.045, scoreAfter: 0.18,
      sacks: { p1: { name: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true } },
      ...overrides,
    });
  };

  test('singles: the untiered hazard sack is stamped and the card names the hazards', () => {
    const analysis = t19();
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.sacrifice).toEqual({ name: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true, verified: true });
    const summary = summarizeTurn(analysis, names);
    expect(summary).toContain('Alpha sacked Weavile (22% HP) into the entry hazards');
  });

  test('when the rolls after the pair carried the gain, the hazard sack earns nothing', () => {
    expect(t19({ scoreAfter: 0.4 }).p1.sacrifice).toBeUndefined();
  });
});

describe('doubles: the same forms ride on the pair choice', () => {
  test('an untiered stayed feed of a doubles side is stamped like a singles one', () => {
    const result: EvalResult = {
      score: 0.3, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          ranked('move protect, move heatwave', 'Protect + Heat Wave', 0.2, 0.3, 0.25, 'Close Combat→Chi-Yu + Protect'),
          ranked('move darkpulse 1, move heatwave', 'Dark Pulse→Rillaboom + Heat Wave', -0.1, 0.3, 0.2, 'Close Combat→Chi-Yu + Protect'),
        ],
        p2: [ranked('move closecombat 1, move protect', 'Close Combat→Chi-Yu + Protect', -0.2, -0.2, -0.2, null)],
      },
    };
    const analysis = analyzeTurn({
      turn: 9, result,
      played: {
        p1: null, p2: null,
        p1Slots: [{ kind: 'move', name: 'Dark Pulse', targetLoc: 1 }, { kind: 'move', name: 'Heat Wave', targetLoc: null }],
        p2Slots: [{ kind: 'move', name: 'Close Combat', targetLoc: 1 }, { kind: 'move', name: 'Protect', targetLoc: null }],
      },
      playedOutcome: -0.1, futureOutcomes: [0.2, 0.4],
      scoreBefore: 0.3, scoreAfter: -0.12,
      sacks: { p1: { name: 'Chi-Yu', hpFraction: 0.5, stayed: true } },
    });
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.sacrifice).toEqual({ name: 'Chi-Yu', hpFraction: 0.5, stayed: true, verified: true });
  });
});

describe('the read credit without a band (648453 t13)', () => {
  /** p2 switches Lopunny-Mega in against the Hidden Power Ice; the engine's equilibrium gave the switch no weight. */
  const t13 = (overrides: Partial<AnalyzeTurnParams> = {}, lopunnyWeight = 0) => {
    const result: EvalResult = {
      score: 0.0596, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [ranked('move hiddenpowerice', 'Hidden Power Ice', 0.1, 0.1, 0.1, 'switch Bisharp')],
        p2: [
          ranked('switch 5', '→ Bisharp', -0.1861, 0.0073, -0.1061, 'Heat Wave'),
          ranked('switch 2', '→ Keldeo', -0.3, 0.0, -0.11, 'Hurricane'),
          ranked('switch 6', '→ Lopunny-Mega', -0.2126, -0.0095, -0.1679, 'Hurricane'),
        ],
      },
      matrix: {
        p1Labels: ['Hidden Power Ice', 'Heat Wave'], p2Labels: ['→ Bisharp', '→ Keldeo', '→ Lopunny-Mega'],
        p1Choices: ['move hiddenpowerice', 'move heatwave'], p2Choices: ['switch 5', 'switch 2', 'switch 6'],
        values: [[-0.042, 0.071, 0.069], [0.1, -0.05, 0.2]],
        mixes: { p1: [0.5, 0.5], p2: [0.57 - lopunnyWeight, 0.43, lopunnyWeight] },
      },
    };
    return analyzeTurn({
      turn: 13, result,
      played: { p1: { kind: 'move', name: 'Hidden Power' }, p2: { kind: 'switch', name: 'Mandy', species: 'Lopunny-Mega' } },
      playedOutcome: 0.00097, futureOutcomes: [-0.279, -0.569, -0.422],
      scoreBefore: 0.0596, scoreAfter: 0.0475,
      ...overrides,
    });
  };

  test('singles: the zero-weight switch that paid at once and grew over the window earns the card sentence', () => {
    const analysis = t13();
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.readCredit?.payoff).toBeCloseTo(0.755, 3);
    expect(analysis.p2.readCredit?.payoffTurn).toBe(2);
    expect(summarizeTurn(analysis, names)).toContain('Beta played switching to Lopunny-Mega — a read the engine gave no weight: 2 turns later, before the rolls');
    // Not a risk credit: the attribution, the report's read list and the totals stay as they were.
    expect(analysis.p2.riskPaidOff).toBeUndefined();
    expect(analysis.attribution).toBe('quiet');
    expect(buildGameReport([analysis, analysis, analysis].map((entry, index) => ({ ...entry, turn: 13 + index })), names, 'p2').reads)
      .toEqual([]);
  });

  test('guards: a choice the equilibrium plays, a small immediate payoff, or a lost position earn nothing', () => {
    expect(t13({}, 0.3).p2.readCredit).toBeUndefined();
    expect(t13({ playedOutcome: 0.1 }).p2.readCredit).toBeUndefined();
    expect(t13({ scoreBefore: 0.75 }).p2.readCredit).toBeUndefined();
  });

  test('a stamped sacrifice takes no read credit on the same turn', () => {
    // Had the switch-in fallen to the hazards, the sacrifice stamp would carry the turn instead.
    const stamped = t13({ sacks: { p2: { name: 'Mandy', hpFraction: 0.8, healthy: true, hazard: true } } });
    expect(stamped.p2.sacrifice?.hazard).toBe(true);
    expect(stamped.p2.readCredit).toBeUndefined();
  });
});

describe('the read credit on a doubles pair', () => {
  test('a zero-weight combo that paid at once and grew over the window earns the sentence too', () => {
    const result: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          ranked('move tailwind, move protect', 'Tailwind + Protect', -0.1, 0.1, 0.15, 'Heat Wave + Protect'),
          ranked('move tailwind, move solarbeam 1', 'Tailwind + Solar Beam→Groudon', -0.2, 0.1, 0.1, 'Heat Wave + Protect'),
        ],
        p2: [ranked('move heatwave, move protect', 'Heat Wave + Protect', -0.1, -0.1, -0.1, null)],
      },
      matrix: {
        p1Labels: ['Tailwind + Protect', 'Tailwind + Solar Beam→Groudon'], p2Labels: ['Heat Wave + Protect'],
        p1Choices: ['move tailwind, move protect', 'move tailwind, move solarbeam 1'], p2Choices: ['move heatwave, move protect'],
        values: [[0.15], [0.1]],
        mixes: { p1: [1, 0], p2: [1] },
      },
    };
    const analysis = analyzeTurn({
      turn: 1, result,
      played: {
        p1: null, p2: null,
        p1Slots: [{ kind: 'move', name: 'Tailwind', targetLoc: null }, { kind: 'move', name: 'Solar Beam', targetLoc: 1 }],
        p2Slots: [{ kind: 'move', name: 'Heat Wave', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
      },
      playedOutcome: 0.1, futureOutcomes: [0.3, 0.5],
      scoreBefore: 0.1, scoreAfter: 0.12,
    });
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.readCredit).toEqual({ payoff: expect.closeTo(0.6, 6), payoffTurn: 2 });
    expect(analysis.p1.riskPaidOff).toBeUndefined();
    // Round 63 fix: measured before the rolls; a roll that moved the side gets its luck tail (2629703929 t1: −7%).
    const rolled = { ...analysis, scoreAfter: -0.03, chanceDelta: -0.13 };
    const summary = summarizeTurn(rolled, names);
    expect(summary).toContain('Alpha played Tailwind + Solar Beam→Groudon — a read the engine gave no weight: 2 turns later, before the rolls,');
    expect(summary).toContain('On top of that, luck contributed −7% for Alpha.');
  });
});

/**
 * Round 63 fix: a body the opponent's near-decided click removes is the
 * opponent's way into its sweep, so letting it fall is no win-condition
 * sacrifice (649664 t20: "Medicham-Mega is one sure KO from clearing the
 * rest — removing Lopunny-Mega …", then "BKC fed Lopunny … verified").
 */
describe('no praise for feeding the body the opponent\'s near sweep removes', () => {
  const stayedFeed = (args: {
    near?: { side: 'p1' | 'p2'; species: string; removes: string };
    sack: SackInfo;
    doubles?: boolean;
  }) => {
    const result: EvalResult = {
      score: 0.35, interval: 0, depthCompleted: 1,
      perSide: args.doubles
        ? {
          p1: [
            ranked('switch 3, move protect', '→ Incineroar + Protect', 0.1, 0.3, 0.4, 'Heat Wave + Protect'),
            ranked('move bloodmoon 1, move protect', 'Blood Moon→Chi-Yu + Protect', -0.1, 0.3, 0.38, 'Heat Wave + Protect'),
          ],
          p2: [ranked('move heatwave, move protect', 'Heat Wave + Protect', -0.2, -0.2, -0.2, null)],
        }
        : {
          p1: [
            ranked('switch 4', '→ Excadrill', 0.1, 0.3, 0.4, 'Fake Out'),
            ranked('move return', 'Return 102', -0.1, 0.3, 0.38, 'Fake Out'),
          ],
          p2: [ranked('move fakeout', 'Fake Out', -0.2, -0.2, -0.2, null)],
        },
      ...(args.near ? { unanswered: { p1: [], p2: [], nearDecided: { ...args.near, odds: 1 } } } : {}),
    };
    return analyzeTurn({
      turn: 20, result,
      played: args.doubles
        ? {
          p1: null, p2: null,
          p1Slots: [{ kind: 'move', name: 'Blood Moon', targetLoc: 1 }, { kind: 'move', name: 'Protect', targetLoc: null }],
          p2Slots: [{ kind: 'move', name: 'Heat Wave', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
        }
        : { p1: { kind: 'move', name: 'Return' }, p2: { kind: 'move', name: 'Fake Out' } },
      playedOutcome: -0.1, futureOutcomes: [0.2, 0.4],
      scoreBefore: 0.35, scoreAfter: -0.12,
      sacks: { p1: args.sack },
    });
  };
  const lopunny: SackInfo = { name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 0.63, stayed: true };

  test('singles, 649664 t20: Medicham-Mega\'s near click removes Lopunny-Mega, so BKC feeding it earns no stamp', () => {
    const analysis = stayedFeed({ near: { side: 'p2', species: 'Medicham-Mega', removes: 'Lopunny-Mega' }, sack: lopunny });
    expect(analysis.p1.sacrifice).toBeUndefined();
    expect(summarizeTurn(analysis, names)).not.toContain('fed Lopunny');
  });

  test('doubles, 912045 t7: the near click removes the fed Chi-Yu, so no stamp either', () => {
    const chiYu: SackInfo = { name: 'Chi-Yu', species: 'Chi-Yu', hpFraction: 0.25, stayed: true };
    const analysis = stayedFeed({ near: { side: 'p2', species: 'Ursaluna-Bloodmoon', removes: 'Chi-Yu' }, sack: chiYu, doubles: true });
    expect(analysis.p1.sacrifice).toBeUndefined();
  });

  test('guards: a near click on another body, or the own side\'s near stage, leaves the stamp', () => {
    expect(stayedFeed({ near: { side: 'p2', species: 'Medicham-Mega', removes: 'Excadrill' }, sack: lopunny }).p1.sacrifice?.verified).toBe(true);
    expect(stayedFeed({ near: { side: 'p1', species: 'Lopunny-Mega', removes: 'Medicham-Mega' }, sack: lopunny }).p1.sacrifice?.verified).toBe(true);
    expect(stayedFeed({ sack: lopunny }).p1.sacrifice?.verified).toBe(true);
  });
});

/**
 * Round 63 fix: the read credit's gates read the pair's value before the
 * rolls, so its sentence says so, and it names the turn's own luck when the
 * rolls moved the side by an inaccuracy or more (649664 t15: "+16% over the
 * safe Hydro Pump (47% guaranteed)" while devin's bar ended on the floor).
 */
describe('the read credit says it is measured before the rolls', () => {
  const t13Shape = (scoreAfter: number) => {
    const result: EvalResult = {
      score: 0.0596, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [ranked('move hiddenpowerice', 'Hidden Power Ice', 0.1, 0.1, 0.1, 'switch Bisharp')],
        p2: [
          ranked('switch 5', '→ Bisharp', -0.1861, 0.0073, -0.1061, 'Heat Wave'),
          ranked('switch 6', '→ Lopunny-Mega', -0.2126, -0.0095, -0.1679, 'Hurricane'),
        ],
      },
      matrix: {
        p1Labels: ['Hidden Power Ice'], p2Labels: ['→ Bisharp', '→ Lopunny-Mega'],
        p1Choices: ['move hiddenpowerice'], p2Choices: ['switch 5', 'switch 6'],
        values: [[-0.042, 0.069]], mixes: { p1: [1], p2: [1, 0] },
      },
    };
    return summarizeTurn(analyzeTurn({
      turn: 13, result,
      played: { p1: { kind: 'move', name: 'Hidden Power' }, p2: { kind: 'switch', name: 'Mandy', species: 'Lopunny-Mega' } },
      playedOutcome: 0.00097, futureOutcomes: [-0.279, -0.569, -0.422],
      scoreBefore: 0.0596, scoreAfter,
    }), names);
  };

  test('singles: the gain is the pair\'s value before the rolls, with no claim that it paid off', () => {
    const summary = t13Shape(0.0475);
    expect(summary).toContain('Beta played switching to Lopunny-Mega — a read the engine gave no weight: ' +
      '2 turns later, before the rolls, it stood +38% over the safe switching to Bisharp (41% guaranteed).');
    expect(summary).not.toContain('paid off');
    // A roll under an inaccuracy stays unnamed.
    expect(summary).not.toContain('luck contributed');
  });

  test('singles, 649664 t15 shape: when the rolls took the gain back, the luck tail says so for the side', () => {
    expect(t13Shape(0.3)).toContain('On top of that, luck contributed −15% for Beta.');
  });
});
