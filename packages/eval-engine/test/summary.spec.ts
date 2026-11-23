import { test, expect, describe } from 'vitest';
import { analyzeTurn, type AnalyzeTurnParams, TIER_THRESHOLDS, type SideAnalysis, type TurnAnalysis } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { buildGameReport } from '../src/report';
import type { SackInfo, PlayedTurn } from '../src/played';
import type { EvalResult, RankedChoice, EvalMatrix, MctsTreeStats } from '../src/types';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';

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
    expect(summarizeTurn(analysis, names)).toContain('Beta switched to Lopunny-Mega, a read the engine gave no weight: 2 turns later, before the rolls');
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
    expect(summary).toContain('Alpha played Tailwind and Solar Beam→Groudon, a read the engine gave no weight: 2 turns later, before the rolls,');
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
    expect(summary).toContain('Beta switched to Lopunny-Mega, a read the engine gave no weight: ' +
      '2 turns later, before the rolls, it stood +38% over the safe switch to Bisharp (41% guaranteed).');
    expect(summary).not.toContain('paid off');
    // A roll under an inaccuracy stays unnamed.
    expect(summary).not.toContain('luck contributed');
  });

  test('singles, 649664 t15 shape: when the rolls took the gain back, the luck tail says so for the side', () => {
    // Round 67 (T59): the side holds its ground here (−0.09); 649664 t15 itself moved +0.016 for devin on the base.
    expect(t13Shape(0.15)).toContain('On top of that, luck contributed −7% for Beta.');
    // A turn that cost the side at least 0.1 gets no credit at all.
    expect(t13Shape(0.3)).not.toContain('a read the engine gave no weight');
  });
});

const rowOf = (choiceId: string, label: string, ev: number): RankedChoice =>
  ({ choice: choiceId, label, worstCase: ev - 0.1, expected: ev, ev, punishedBy: 'Reply' });

type Cells = EvalMatrix['cells'];
const MISS = { visits: 2, verified: false };
const SEEN = { visits: 20, verified: false };

interface Shape {
  p1Choices: string[]; p1Labels: string[]; p1Ev: number[];
  p2Choices: string[]; p2Labels: string[];
  /** p1-perspective cell values. */
  values: number[][];
  played: PlayedTurn;
}

const resultOf = (shape: Shape, cells?: Cells): EvalResult => ({
  score: 0.05, interval: 0.02, depthCompleted: 1,
  perSide: {
    // The list is ranked: best equilibrium value first, as the search hands it over.
    p1: shape.p1Choices.map((choiceId, i) => rowOf(choiceId, shape.p1Labels[i], shape.p1Ev[i])).sort((a, b) => b.ev - a.ev),
    p2: shape.p2Choices.map((choiceId, j) => rowOf(choiceId, shape.p2Labels[j], -0.05 - j * 0.01)),
  },
  matrix: {
    p1Labels: shape.p1Labels, p2Labels: shape.p2Labels,
    p1Choices: shape.p1Choices, p2Choices: shape.p2Choices,
    values: shape.values,
    mixes: { p1: shape.p1Choices.map(() => 1 / shape.p1Choices.length), p2: shape.p2Choices.map(() => 1 / shape.p2Choices.length) },
    ...(cells ? { cells } : {}),
  },
});

const analyze = (result: EvalResult, played: PlayedTurn) => analyzeTurn({
  turn: 6, result, played, playedOutcome: 0, scoreBefore: 0.05, scoreAfter: 0.0,
});

/**
 * Doubles: p1 played row 0 ("Icy Wind + Protect") into p2's pair
 * "Protect + Drain Punch" (column 0). Against that column the row
 * "Tackle + Protect" is worth 0.40 more (-0.30 against +0.10), while the
 * equilibrium prices the two rows 0.05 apart.
 */
const doublesShape = (): Shape => ({
  p1Choices: ['move icywind, move protect', 'move tackle 1, move protect'],
  p1Labels: ['Icy Wind + Protect', 'Tackle→Incineroar + Protect'],
  p1Ev: [0.05, 0.10],
  p2Choices: ['move protect, move drainpunch 1', 'move rockslide, move ragefist 1'],
  p2Labels: ['Protect + Drain Punch→Incineroar', 'Rock Slide + Rage Fist→Incineroar'],
  values: [[-0.30, 0.20], [0.10, 0.10]],
  played: {
    p1: null, p2: null,
    p1Slots: [{ kind: 'move', name: 'Icy Wind', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
    p2Slots: [{ kind: 'move', name: 'Protect', targetLoc: null }, { kind: 'move', name: 'Drain Punch', targetLoc: 1 }],
  },
});

/**
 * Singles: p2 played a U-turn, and the matrix lists a pivot only as pair
 * rows ("move uturn > switch 2"). p1 played Iron Head; Earth Power is worth
 * 0.35 more against the pair actually clicked.
 */
const singlesShape = (): Shape => ({
  p1Choices: ['move ironhead', 'move earthpower'],
  p1Labels: ['Iron Head', 'Earth Power'],
  p1Ev: [0.05, 0.10],
  p2Choices: ['move uturn > switch 2', 'move uturn > switch 3'],
  p2Labels: ['U-turn → Clefable', 'U-turn → Noivern'],
  values: [[-0.25, 0.20], [0.10, 0.10]],
  played: {
    p1: { kind: 'move', name: 'Iron Head', tera: false },
    p2: { kind: 'move', name: 'U-turn', tera: false, pivotTarget: 'Clefable' },
  },
});

describe('the hindsight read finds the opponent click on both game types', () => {
  test('doubles: the pair of slots the opponent clicked is a column (red before: no read at all)', () => {
    const analysis = analyze(resultOf(doublesShape()), doublesShape().played);
    expect(analysis.p1.hindsightRead).toMatchObject({
      response: 'Tackle→Incineroar + Protect', against: 'Protect + Drain Punch→Incineroar',
    });
    expect(analysis.p1.hindsightRead!.gain).toBeCloseTo(0.40, 10);
  });

  test('doubles: a hidden slot of the opponent gives no column (no charitable pick for what was clicked)', () => {
    const shape = doublesShape();
    shape.played = { ...shape.played, p2Slots: [{ kind: 'move', name: 'Protect', targetLoc: null }, null] };
    expect(analyze(resultOf(shape), shape.played).p1.hindsightRead).toBeUndefined();
  });

  test('singles pivot: the pair row of the clicked U-turn is still found', () => {
    const shape = singlesShape();
    const analysis = analyze(resultOf(shape), shape.played);
    expect(analysis.p1.hindsightRead).toMatchObject({ response: 'Earth Power', against: 'U-turn → Clefable' });
    expect(analysis.p1.hindsightRead!.gain).toBeCloseTo(0.35, 10);
  });
});

describe('the read is shown only past the regret and a cell that is not a guess', () => {
  const shapes: [string, () => Shape][] = [['doubles', doublesShape], ['singles', singlesShape]];
  // The cell of the best own row (row 1) against the clicked column (column 0).
  const cellsWith = (best: { visits: number; verified: boolean }): Cells => [
    [SEEN, SEEN],
    [best, SEEN],
  ];
  const readOf = (make: () => Shape, cells?: Cells): SideAnalysis['hindsightRead'] => {
    const shape = make();
    return analyze(resultOf(shape, cells), shape.played).p1.hindsightRead;
  };

  for (const [name, make] of shapes) {
    test(`${name}: a cell with 2 visits that nobody verified is not shown (912045 t8 shape), 8 visits is`, () => {
      expect(readOf(make, cellsWith(MISS))?.shown).toBeUndefined();
      expect(readOf(make, cellsWith({ visits: 7, verified: false }))?.shown).toBeUndefined();
      expect(readOf(make, cellsWith({ visits: 8, verified: false }))?.shown).toBe(true);
    });

    test(`${name}: a verified cell is shown whatever its visits`, () => {
      expect(readOf(make, cellsWith({ visits: 2, verified: true }))?.shown).toBe(true);
    });

    test(`${name}: a result without cells (matrix mode, old cache) counts as matrix grade`, () => {
      expect(readOf(make)?.shown).toBe(true);
    });
  }

  test('a gain under the regret plus the band is not shown, the read itself stays for the prose', () => {
    // Equilibrium regret 0.30 (best 0.35, played 0.05); gain against the click 0.40 < 0.30 + 0.10 + epsilon.
    const shape = doublesShape();
    shape.p1Ev = [0.05, 0.36];
    const read = analyze(resultOf(shape, [[SEEN, SEEN], [SEEN, SEEN]]), shape.played).p1.hindsightRead;
    expect(read).toBeDefined();
    expect(read!.shown).toBeUndefined();
    // The band is one tier step: a regret one hundredth under (gain - band) shows it.
    shape.p1Ev = [0.05, 0.05 + (0.40 - TIER_THRESHOLDS.inaccuracy - 0.01)];
    expect(analyze(resultOf(shape, [[SEEN, SEEN], [SEEN, SEEN]]), shape.played).p1.hindsightRead!.shown).toBe(true);
  });

  for (const [name, make] of shapes) {
    test(`${name}: the read never grades (tier, regret and every other field equal with or without it)`, () => {
      const shape = make();
      const shown = analyze(resultOf(shape, cellsWith(SEEN)), shape.played);
      const hidden = analyze(resultOf(shape, cellsWith(MISS)), shape.played);
      expect(shown.p1.hindsightRead?.shown).toBe(true);
      expect(hidden.p1.hindsightRead?.shown).toBeUndefined();
      const bare = (analysis: typeof shown) => ({
        ...analysis, p1: { ...analysis.p1, hindsightRead: undefined }, p2: { ...analysis.p2, hindsightRead: undefined },
      });
      expect(bare(hidden)).toEqual(bare(shown));
      expect(shown.p1.regret).toBeCloseTo(0.05, 10);
    });
  }
});

describe('the card sentences quote a read only where its cell holds (gate of 12.10. 19:17)', () => {
  const shapes: [string, () => Shape][] = [['doubles', doublesShape], ['singles', singlesShape]];
  const cellsWith = (best: { visits: number; verified: boolean }): Cells => [[SEEN, SEEN], [best, SEEN]];
  const readOf = (make: () => Shape, cells?: Cells): SideAnalysis['hindsightRead'] => {
    const shape = make();
    return analyze(resultOf(shape, cells), shape.played).p1.hindsightRead;
  };
  const names: [string, string] = ['Alpha', 'Beta'];
  const card = (p1Read: SideAnalysis['hindsightRead'], p2Read?: SideAnalysis['hindsightRead']): TurnAnalysis => {
    const side = (read: SideAnalysis['hindsightRead']): SideAnalysis =>
      ({ playedRaw: null, played: null, best: null, safe: null, regret: 0, ...(read ? { hindsightRead: read } : {}) });
    return {
      turn: 8, scoreBefore: 0, scoreAfter: 0.02, swing: 0.02, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0.02,
      attribution: 'shift', p1: side(p1Read), p2: side(p2Read), playedTracking: true,
    };
  };

  for (const [name, make] of shapes) {
    test(`${name}: the read marks a thin cell (under 8 visits, not verified) and leaves a solid one unmarked`, () => {
      expect(readOf(make, cellsWith(MISS))).toMatchObject({ thin: true });
      expect(readOf(make, cellsWith({ visits: 7, verified: false }))?.thin).toBe(true);
      expect(readOf(make, cellsWith({ visits: 8, verified: false }))?.thin).toBeUndefined();
      expect(readOf(make, cellsWith({ visits: 2, verified: true }))?.thin).toBeUndefined();
      // No cells (matrix mode, a result from before the field) is matrix grade: it passes.
      expect(readOf(make)?.thin).toBeUndefined();
    });

    test(`${name}: the shift sentence drops the thin read and keeps the solid one`, () => {
      const thin = readOf(make, cellsWith(MISS))!;
      const solid = readOf(make, cellsWith(SEEN))!;
      expect(summarizeTurn(card(thin), names)).not.toContain('The read was there');
      expect(summarizeTurn(card(solid), names)).toContain('The read was there for Alpha');
      // The solid read of the other side speaks even when the thin one has the larger gain.
      const other = { ...solid, gain: solid.gain / 2 };
      const text = summarizeTurn(card({ ...thin, gain: 1 }, other), names);
      expect(text).toContain('The read was there for Beta');
      expect(text).not.toContain('The read was there for Alpha');
    });
  }

  test('the thin read still exists on the analysis (display only: the gate takes nothing from grading)', () => {
    const read = readOf(doublesShape, cellsWith(MISS));
    expect(read).toMatchObject({ response: 'Tackle→Incineroar + Protect', against: 'Protect + Drain Punch→Incineroar' });
    expect(read?.shown).toBeUndefined();
  });
});

describe('the merge writes the visits and the verified flag of every cell', () => {
  const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
  const mk = (p1: string[], p2: string[], cells: MctsTreeStats['cells']): MctsTreeStats => ({
    p1Options: options(p1), p2Options: options(p2),
    p1N: p1.map(() => 5), p1W: p1.map(() => 1), p2N: p2.map(() => 5), p2W: p2.map(() => 1),
    visits: 10, depth: 2, rootValue: 0.1, cells, result: emptyResult,
  });
  const cell = (i: number, j: number, visits: number) => ({ key: cellKey(i, j), visits, total: 0.1 * visits, value: 0.1, ended: false });

  test.each([
    ['singles', ['A', 'B'], ['X', 'Y']],
    ['doubles', ['move a 1, move b', 'switch 3, move b'], ['move x, move y 2', 'move x, switch 3']],
  ])('%s: visits are the pooled visits, verified marks the re-priced keys, unvisited cells read 0', (_name, p1, p2) => {
    const t1 = mk(p1, p2, [cell(0, 0, 8), cell(0, 1, 2), cell(1, 0, 3)]);
    const t2 = mk(p1, p2, [cell(0, 0, 4), cell(1, 0, 1)]);
    const verified = new Map([[cellKey(1, 0), { i: 1, j: 0, value: 0.05, ended: false }]]);
    const merged = mergeMctsTrees([t1, t2], verified);
    expect(merged.matrix!.cells).toEqual([
      [{ visits: 12, verified: false }, { visits: 2, verified: false }],
      [{ visits: 4, verified: true }, { visits: 0, verified: false }],
    ]);
    // Index-aligned with the values the equilibrium was solved over.
    expect(merged.matrix!.cells!.length).toBe(merged.matrix!.values.length);
    expect(merged.matrix!.cells![0].length).toBe(merged.matrix!.values[0].length);
    // Without verification nothing is verified.
    expect(mergeMctsTrees([t1, t2]).matrix!.cells!.flat().some(entry => entry.verified)).toBe(false);
  });
});

describe('a single tree writes its own cells (no merge happens for one tree)', () => {
  const set = (name: string, species: string, moves: string[], level: number): PokemonSet => ({
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
  });
  const battle = (): string => {
    const sim = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([set('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt'], 100), set('Lax', 'Snorlax', ['Body Slam'], 100)]) },
      p2: { name: 'Beta', team: Teams.pack([set('Champ', 'Machamp', ['Seismic Toss'], 100), set('Egg', 'Chansey', ['Soft-Boiled'], 100)]) },
    });
    if (sim.sides.some(side => side.requestState === 'teampreview')) { sim.choose('p1', 'team 12'); sim.choose('p2', 'team 12'); }
    return JSON.stringify(State.serializeBattle(sim));
  };

  test('singles: the matrix of the tree result carries the visits of the tree cells and nothing verified', () => {
    const stats = mctsTreeSearch(battle(), { depth: 1, samples: 1, tera: false, mode: 'mcts', prove: false }, 0);
    expect(mergeMctsTrees([stats])).toBe(stats.result);
    const matrix = stats.result.matrix!;
    const cells = matrix.cells!;
    expect(cells.length).toBe(stats.p1Options.length);
    for (let i = 0; i < cells.length; i++) {
      expect(cells[i].length).toBe(stats.p2Options.length);
      for (let j = 0; j < cells[i].length; j++) {
        const own = stats.cells.find(entry => entry.key === cellKey(i, j));
        expect(cells[i][j]).toMatchObject({ visits: own?.visits ?? 0, verified: false });
      }
    }
    expect(cells.flat().some(entry => entry.visits > 0)).toBe(true);
  });
});

const choice = (choiceStr: string, label: string, ev: number, worstCase = ev): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: ev, ev, punishedBy: 'Reply' });

describe('point 2: the forced win names its unit', () => {
  const forcedSummary = (forcedWin: NonNullable<EvalResult['forcedWin']>, score: number, doubles = false) => summarizeTurn(analyzeTurn({
    turn: 24,
    result: {
      score, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice(doubles ? 'move 1 1, move 2 2' : 'move hydropump', doubles ? 'Tera Starstorm + Earth Power' : 'Hydro Pump', 0.8)],
        p2: [choice(doubles ? 'move 1 1, move 1 2' : 'move roost', doubles ? 'Protect + Body Press' : 'Roost', -0.8)],
      },
      forcedWin,
    },
    played: null, playedOutcome: null, scoreBefore: score, scoreAfter: null, playedTracking: !doubles,
  }), names);

  test('singles (649664 t24): "wins within 5 turns", the open event and the caveat as before', () => {
    const summary = forcedSummary({
      side: 'p1', turns: 5, mass: 0.8, caveat: 'barring-crit', engineScore: 0.8, states: 40,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' },
    }, 0.7875);
    expect(summary).toContain('Alpha wins within 5 turns against every reply if the 80% Hydro Pump lands, barring a crit.');
    expect(summary).not.toMatch(/wins in \d/);
  });

  test('doubles (2630685175 t7): one turn reads "within 1 turn"', () => {
    const summary = forcedSummary({ side: 'p1', turns: 1, mass: 1, caveat: 'sampled-rolls', engineScore: 1, states: 6 }, 1, true);
    expect(summary).toContain('Alpha wins within 1 turn against every reply on the sampled rolls.');
  });
});
