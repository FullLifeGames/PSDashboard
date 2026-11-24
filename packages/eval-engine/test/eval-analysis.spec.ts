import { test, expect, describe } from 'vitest';
import { analyzeTurn, decidedSeenKey, findPlayedOption, matchPlayedChoice, phantomStayIn, REGRET_THRESHOLD, unansweredSeenKey } from '../src/analysis';
import { logRules } from '@fulllifegames/replay-core';
import { allTurnEvents, detectSacks, turnEvents } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';
import type { TurnSnapshot } from '@fulllifegames/replay-core';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const choiceEv = (choiceStr: string, label: string, worstCase: number, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev, punishedBy: 'Reply' });

const result: EvalResult = {
  score: 0.1,
  interval: 0.05,
  depthCompleted: 2,
  perSide: {
    p1: [
      choice('move dracometeor', 'Draco Meteor', 0.2),
      choice('move uturn', 'U-turn', 0.05),
      choice('switch 2', '→ Corviknight', -0.1),
    ],
    p2: [
      choice('switch 3', '→ Dragapult', -0.05),
      choice('move recover', 'Recover', -0.3),
      choice('move freezedry terastallize', 'Tera + Freeze-Dry', -0.4),
    ],
  },
};

const sackSnapshot = (hpPercent: number): TurnSnapshot => ({
  turn: 29,
  p1: {
    name: 'P1', id: 'p1', sideConditions: {},
    pokemon: [{
      name: 'Dauni', speciesForme: 'Uxie', hp: 17, maxhp: 182, hpPercent,
      status: '', fainted: false, isActive: true, boosts: {}, moves: [],
      ability: '', item: '', terastallized: '', level: 50, gender: '',
    }],
  },
  p2: { name: 'P2', id: 'p2', pokemon: [], sideConditions: {} },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
});

describe('verdict tiers in wp-units', () => {
  test('bands sit at 5/10/20% win-probability loss', () => {
    const at = (playedEv: number) => analyzeTurn({
      turn: 5,
      result: {
        score: 0, interval: 0, depthCompleted: 1,
        perSide: {
          p1: [choiceEv('move a', 'A', 0.5, 0.5), choiceEv('move b', 'B', 0.5 - 1, playedEv)],
          p2: [choice('move x', 'X', 0)],
        },
      },
      played: { p1: { kind: 'move', name: 'B', tera: false }, p2: { kind: 'move', name: 'X', tera: false } },
      playedOutcome: null,
      scoreBefore: 0,
      scoreAfter: null,
    }).p1.tier;
    // regret = 0.5 − playedEv (wp-units; 0.1 units = 5% win probability).
    expect(at(0.5 - 0.17)).toBe('inaccuracy'); // 8.5% loss
    expect(at(0.5 - 0.25)).toBe('mistake');
    expect(at(0.5 - 0.35)).toBe('mistake');
    expect(at(0.5 - 0.45)).toBe('blunder');
    expect(at(0.5 - 0.05)).toBeUndefined();
  });
});

describe('read-aware risk phrasing', () => {
  test('a risk matching the read is marked as a read on tendencies', () => {
    const at = (readLabel?: string, choiceId?: string) => analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
      ...(readLabel
        ? {
          reads: {
            p2: {
              choice: { label: readLabel, ev: 0.1, worstCase: -0.3, ...(choiceId ? { choiceId } : {}) },
              net: 0.1, confidence: 0.7,
              breakdown: [],
            },
          },
        }
        : {}),
    });
    expect(at().p2.riskUnpunished).toBe(true);
    expect(at().p2.riskWasRead).toBeFalsy();
    expect(at('Recover').p2.riskWasRead).toBe(true);
    expect(at('→ Dragapult').p2.riskWasRead).toBeFalsy();
    expect(at('Mislabeled', 'move recover').p2.riskWasRead).toBe(true);
    expect(at('Recover', 'move protect').p2.riskWasRead).toBeFalsy();
  });
});

describe('sensitivity probes', () => {
  test('a sensitivity probe that clears the verdict softens it and records the hinge', () => {
    const analysis = analyzeTurn({
      turn: 20, result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0, scoreBefore: 0.1, scoreAfter: -0.25,
      sensitivity: { p2: [{ species: 'Heatran', item: 'Leftovers', playedEv: -0.06, bestEv: -0.05 }] },
    });
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.sensitivity).toEqual({
      species: 'Heatran',
      alternatives: [{ item: 'Leftovers', tier: 'none' }],
    });
  });

  test('probes never make a verdict harsher', () => {
    const analysis = analyzeTurn({
      turn: 20, result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0, scoreBefore: 0.1, scoreAfter: -0.25,
      sensitivity: { p2: [{ species: 'Heatran', item: 'Choice Specs', playedEv: -0.9, bestEv: 0.2 }] },
    });
    expect(analysis.p2.tier).toBe('mistake');
    expect(analysis.p2.sensitivity).toBeUndefined();
  });
});

describe('sacrifice detection', () => {
  test('turnEvents slices the lines strictly between turn markers', () => {
    const log = ['|start', '|turn|1', '|move|a', '|turn|2', '|move|b', '|win|X'].join('\n');
    expect(turnEvents(log, 1)).toEqual(['|move|a']);
    expect(turnEvents(log, 2)).toEqual(['|move|b', '|win|X']);
    expect(turnEvents(log, 3)).toEqual([]);
    const index = allTurnEvents(log);
    expect(index[1]).toEqual(turnEvents(log, 1));
    expect(index[2]).toEqual(turnEvents(log, 2));
    expect(index[3]).toBeUndefined();
  });

  test('detectSacks flags a fainted mon that started the turn nearly dead', () => {
    const events = [
      '|switch|p1a: Dauni|Uxie, L50|17/182',
      '|-damage|p1a: Dauni|0 fnt|[from] Stealth Rock',
      '|faint|p1a: Dauni',
    ];
    expect(detectSacks(events, sackSnapshot(9), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.09, hazard: true } });
    expect(detectSacks(events, sackSnapshot(45), logRules(''))).toEqual({});
    expect(detectSacks(events, null, logRules(''))).toEqual({});
  });

  test('a healthy body switched in and fainted the same turn is a simplification-sack candidate', () => {
    const events = [
      '|switch|p1a: Relous|Salazzle, F|116/253',
      '|move|p2a: Knocker|Knock Off|p1a: Relous',
      '|-damage|p1a: Relous|0 fnt',
      '|faint|p1a: Relous',
    ];
    expect(detectSacks(events, sackSnapshot(46), logRules(''))).toEqual({
      p1: { name: 'Relous', species: 'Salazzle', hpFraction: 116 / 253, healthy: true },
    });
  });

  test('dragged-in faints and surviving switch-ins are not sack candidates', () => {
    expect(detectSacks(['|drag|p1a: Dauni|Uxie, L50|120/182', '|faint|p1a: Dauni'], sackSnapshot(66), logRules(''))).toEqual({});
    expect(detectSacks(['|switch|p1a: Relous|Salazzle, F|116/253'], sackSnapshot(46), logRules(''))).toEqual({});
    expect(detectSacks(['|faint|p1a: Dauni'], sackSnapshot(46), logRules(''))).toEqual({
      p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.46, stayed: true },
    });
  });

  test('a mid-HP faint that stayed in since turn start is a stay-and-die candidate', () => {
    const events = [
      '|move|p1a: Dauni|Knock Off|p2a: Wall',
      '|-damage|p1a: Dauni|0 fnt',
      '|faint|p1a: Dauni',
    ];
    expect(detectSacks(events, sackSnapshot(46), logRules(''))).toEqual({
      p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.46, stayed: true },
    });
    expect(detectSacks(['|drag|p1a: Dauni|Uxie, L50|120/182', '|faint|p1a: Dauni'], sackSnapshot(66), logRules(''))).toEqual({});
    expect(detectSacks(['|faint|p1a: Dauni'], sackSnapshot(9), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.09 } });
    expect(detectSacks(['|faint|p1a: Ghost'], sackSnapshot(46), logRules(''))).toEqual({});
  });

  test('a faint-prevented side gets a charitable stay-in phantom (priority moves excluded)', () => {
    const result: EvalResult = {
      score: 0.2, interval: 0.05, depthCompleted: 1,
      perSide: {
        p1: [choiceEv('move airslash', 'Air Slash', 0.3, 0.35)],
        p2: [
          choiceEv('switch 2', '→ Rotom-Wash', 0.05, 0.1),
          choiceEv('move suckerpunch', 'Sucker Punch', -0.05, 0.0),
          choiceEv('move moonblast', 'Moonblast', -0.25, -0.2),
        ],
      },
    };
    const played = {
      p1: { kind: 'move' as const, name: 'Air Slash', tera: false },
      p2: null,
      prevented: { p2: 'faint' },
    };
    const phantom = phantomStayIn(result, 'p2', played, logRules(''));
    expect(phantom?.choice).toBe('move moonblast');
    expect(phantom?.label).toContain('stayed in');
    expect(phantomStayIn(result, 'p2', { ...played, prevented: {} }, logRules(''))).toBeNull();
    expect(phantomStayIn(result, 'p2', { ...played, prevented: { p2: 'slp' } }, logRules(''))).toBeNull();

    const analysis = analyzeTurn({
      turn: 14,
      result,
      played,
      playedOutcome: 0.35,
      scoreBefore: 0.2,
      scoreAfter: 0.55,
      actives: { p1: null, p2: null, gen: 9 },
    });
    expect(analysis.p2.neverActed).toBe(true);
    expect(analysis.p2.played?.label).toContain('stayed in');
    expect(analysis.p2.tier).toBe('mistake');
    expect(analysis.p2.riskUnpunished).toBeFalsy();
    expect(analysis.attribution).not.toBe('unclear');
  });

  test('a cant-prevented side still reads unclear (its choice may have mattered)', () => {
    const result: EvalResult = {
      score: 0.2, interval: 0.05, depthCompleted: 1,
      perSide: {
        p1: [choiceEv('move airslash', 'Air Slash', 0.3, 0.35)],
        p2: [choiceEv('move moonblast', 'Moonblast', -0.25, -0.2)],
      },
    };
    const analysis = analyzeTurn({
      turn: 20,
      result,
      played: {
        p1: { kind: 'move', name: 'Air Slash', tera: false },
        p2: null,
        prevented: { p2: 'slp' },
      },
      playedOutcome: null,
      scoreBefore: 0.2,
      scoreAfter: 0.55,
    });
    expect(analysis.p2.neverActed).toBeFalsy();
    expect(analysis.attribution).toBe('unclear');
  });

  test('a healthy sack is excused only while the engine stays decisively ahead on both sides of it', () => {
    const sackResult: EvalResult = {
      score: 0.66, interval: 0.05, depthCompleted: 1,
      perSide: {
        p1: [
          choiceEv('move moonblast', 'Moonblast', 0.66, 0.66),
          choiceEv('switch 2', '→ Salazzle', 0.4, 0.46),
        ],
        p2: [choice('move knockoff', 'Knock Off', -0.6)],
      },
    };
    const run = (scoreBefore: number, scoreAfter: number | null) => analyzeTurn({
      turn: 35,
      result: { ...sackResult, score: scoreBefore },
      played: {
        p1: { kind: 'switch', name: 'Relous', species: 'Salazzle' },
        p2: { kind: 'move', name: 'Knock Off', tera: false },
      },
      playedOutcome: null,
      scoreBefore,
      scoreAfter,
      sacks: { p1: { name: 'Relous', hpFraction: 0.46, healthy: true } },
    });
    const excused = run(0.66, 0.41);
    expect(excused.p1.sacrifice).toBeTruthy();
    expect(excused.p1.tier).toBe('inaccuracy');
    expect(run(0.1, 0.41).p1.sacrifice).toBeFalsy();
    expect(run(0.1, 0.41).p1.tier).toBe('mistake');
    expect(run(0.66, 0.1).p1.sacrifice).toBeFalsy();
    expect(run(0.66, null).p1.sacrifice).toBeFalsy();
  });

  test('a low-HP sacrifice demotes the tier and suppresses the risk label', () => {
    const sackResult: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [
          choiceEv('move dracometeor', 'Draco Meteor', 0.2, 0.2),
          choiceEv('switch 2', '→ Uxie', -0.1, 0.0),
        ],
        p2: [choice('move trick', 'Trick', -0.05)],
      },
    };
    const analysis = analyzeTurn({
      turn: 29,
      result: sackResult,
      played: {
        p1: { kind: 'switch', name: 'Dauni', species: 'Uxie' },
        p2: { kind: 'move', name: 'Trick', tera: false },
      },
      playedOutcome: -0.1,
      scoreBefore: 0.1,
      scoreAfter: -0.1,
      sacks: { p1: { name: 'Uxie', hpFraction: 0.09 } },
    });
    expect(analysis.p1.sacrifice).toEqual({ name: 'Uxie', hpFraction: 0.09 });
    expect(analysis.p1.tier).toBe('inaccuracy');
    expect(analysis.p1.riskUnpunished).toBeFalsy();
  });

  test('a blunder-sized throw is not forgiven by the sack label', () => {
    const sackResult: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [
          choiceEv('move dracometeor', 'Draco Meteor', 0.2, 0.2),
          choiceEv('switch 2', '→ Uxie', -0.3, -0.25),
        ],
        p2: [choice('move trick', 'Trick', -0.05)],
      },
    };
    const analysis = analyzeTurn({
      turn: 29,
      result: sackResult,
      played: {
        p1: { kind: 'switch', name: 'Dauni', species: 'Uxie' },
        p2: { kind: 'move', name: 'Trick', tera: false },
      },
      playedOutcome: -0.1,
      scoreBefore: 0.1,
      scoreAfter: -0.3,
      sacks: { p1: { name: 'Uxie', hpFraction: 0.09 } },
    });
    expect(analysis.p1.tier).toBe('blunder');
    expect(analysis.p1.sacrifice).toBeUndefined();
  });

  test('a floor-realized feed whose windowed payoff clears the margin grades as a sacrifice', () => {
    const feedResult: EvalResult = {
      score: 0.17, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [choiceEv('move bodypress', 'Body Press', 0.35, 0.4)],
        p2: [
          choiceEv('switch 2', '→ Garchomp', -0.154, -0.1),
          choiceEv('move knockoff', 'Knock Off', -0.42, -0.42),
        ],
      },
    };
    const run = (over: {
      playedEv?: number; futureOutcomes?: (number | null)[]; playedOutcome?: number | null;
    }) => analyzeTurn({
      turn: 68,
      result: over.playedEv === undefined ? feedResult : {
        ...feedResult,
        perSide: {
          ...feedResult.perSide,
          p2: [feedResult.perSide.p2[0], choiceEv('move knockoff', 'Knock Off', -0.42, over.playedEv)],
        },
      },
      played: {
        p1: { kind: 'move', name: 'Body Press', tera: false },
        p2: { kind: 'move', name: 'Knock Off', tera: false },
      },
      // p1-perspective: the feed looks bad NOW (0.42 => p2-own -0.42), pays off in the window (-0.31 => p2-own +0.31).
      playedOutcome: 'playedOutcome' in over ? over.playedOutcome! : 0.42,
      futureOutcomes: over.futureOutcomes ?? [-0.1, -0.31, null],
      scoreBefore: 0.17,
      scoreAfter: 0.31,
      sacks: { p2: { name: 'Weavile', hpFraction: 0.8, stayed: true } },
    });
    // Peak 0.31 - safe floor -0.154 = payoff 0.464 >= regret 0.32 + margin 0.1.
    const verified = run({});
    expect(verified.p2.sacrifice).toEqual({ name: 'Weavile', hpFraction: 0.8, stayed: true, verified: true });
    expect(verified.p2.tier).toBeUndefined();
    expect(verified.p2.riskUnpunished).toBeFalsy();
    const demoted = run({ futureOutcomes: [-0.1, -0.05, null] });
    expect(demoted.p2.sacrifice).toEqual({ name: 'Weavile', hpFraction: 0.8, stayed: true });
    expect(demoted.p2.tier).toBe('inaccuracy');
    // Regret 0.196 (mistake band), payoff 0.464 ≥ 0.196 + 0.1: verifies.
    const spread = run({ playedEv: -0.35 });
    expect(spread.p2.sacrifice).toEqual({ name: 'Weavile', hpFraction: 0.8, stayed: true, verified: true });
    expect(spread.p2.tier).toBeUndefined();
    expect(run({ playedOutcome: 0.30 }).p2.sacrifice).toBeUndefined();
    expect(run({ futureOutcomes: [0.3, 0.3, 0.3] }).p2.sacrifice).toBeUndefined();
    expect(run({ playedOutcome: null, futureOutcomes: [] }).p2.sacrifice).toBeUndefined();
  });

  test('a blunder-sized feed is never excused', () => {
    const throwResult: EvalResult = {
      score: 0.17, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [choiceEv('move bodypress', 'Body Press', 0.35, 0.4)],
        p2: [
          choiceEv('switch 2', '→ Garchomp', -0.154, 0.1),
          choiceEv('move knockoff', 'Knock Off', -0.42, -0.42),
        ],
      },
    };
    const analysis = analyzeTurn({
      turn: 68, result: throwResult,
      played: {
        p1: { kind: 'move', name: 'Body Press', tera: false },
        p2: { kind: 'move', name: 'Knock Off', tera: false },
      },
      playedOutcome: 0.42, futureOutcomes: [0.5, null, null],
      scoreBefore: 0.17, scoreAfter: 0.31,
      sacks: { p2: { name: 'Weavile', hpFraction: 0.8, stayed: true } },
    });
    expect(analysis.p2.tier).toBe('blunder');
    expect(analysis.p2.sacrifice).toBeUndefined();
  });
});

describe('turn analysis assembly', () => {
  test('matches moves, tera variants, and switches (nickname or species)', () => {
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Draco Meteor', tera: false })?.choice).toBe('move dracometeor');
    expect(matchPlayedChoice(result, 'p2', { kind: 'move', name: 'Freeze-Dry', tera: true })?.choice).toBe('move freezedry terastallize');
    expect(matchPlayedChoice(result, 'p2', { kind: 'switch', name: 'Draggy', species: 'Dragapult' })?.label).toBe('→ Dragapult');
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Unknown Move', tera: false })).toBeNull();
  });

  test('a side that played a clearly worse option gets the decision blame', () => {
    const analysis = analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    });
    expect(analysis.p1.regret).toBe(0);
    expect(analysis.p2.regret).toBeCloseTo(0.25, 10);
    expect(analysis.attribution).toBe('p2-decision');
    expect(analysis.decisionDelta).toBeCloseTo(-0.1, 10);
    expect(analysis.chanceDelta).toBeCloseTo(-0.25, 10);
    expect(analysis.swing).toBeCloseTo(-0.35, 10);
  });

  test('an unpunished risk grades by its payoff over the safe guarantee', () => {
    const at = (playedOutcome: number | null) => analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    });

    const paid = at(-0.2);
    expect(paid.p2.riskUnpunished).toBe(true);
    expect(paid.p2.riskPaidOff).toBe(true);
    expect(paid.p2.riskPayoff).toBeCloseTo(0.25, 10);
    expect(paid.attribution).toBe('p2-read');
    expect(paid.p1.riskUnpunished).toBeUndefined();

    const neutral = at(0.0);
    expect(neutral.p2.riskUnpunished).toBe(true);
    expect(neutral.p2.riskPaidOff).toBeUndefined();
    expect(neutral.attribution).toBe('p2-decision');

    const behind = at(0.2);
    expect(behind.p2.riskUnpunished).toBeUndefined();
    expect(behind.attribution).toBe('p2-decision');

    const unknown = at(null);
    expect(unknown.p2.riskUnpunished).toBe(true);
    expect(unknown.p2.riskPaidOff).toBeUndefined();

    const punished: EvalResult = {
      ...result,
      perSide: { p1: [choice('move reply', 'Reply', 0.2)], p2: result.perSide.p2 },
    };
    const analysisPunished = analyzeTurn({
      turn: 21,
      result: punished,
      played: { p1: { kind: 'move', name: 'Reply', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: -0.2,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    });
    expect(analysisPunished.p2.riskUnpunished).toBeUndefined();
  });

  test('a knife-edge payoff within the noise epsilon still earns the paid-off credit', () => {
    const tied: EvalResult = {
      score: -0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [choiceEv('move ironhead', 'Iron Head', -0.06, -0.05)],
        p2: [
          choiceEv('move recover', 'Recover', 0.04, 0.05),
          choiceEv('switch 5', '→ Heatran', -0.39, 0.047),
        ],
      },
    };
    const at = (playedOutcome: number) => analyzeTurn({
      turn: 20,
      result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome,
      scoreBefore: -0.05,
      scoreAfter: -0.14,
    });
    // Own outcome +0.13 vs safe floor +0.04: payoff 0.09, under the 0.1
    // margin but inside the epsilon band.
    const knifeEdge = at(-0.13);
    expect(knifeEdge.p2.riskPaidOff).toBe(true);
    expect(knifeEdge.p2.riskPayoff).toBeCloseTo(0.09, 10);
    expect(knifeEdge.attribution).toBe('p2-read');
    const below = at(-0.11);
    expect(below.p2.riskPaidOff).toBeUndefined();
    expect(below.attribution).toBe('quiet');
  });

  test('a no-regret gamble that beats the safe guarantee reads as paid off', () => {
    const tied: EvalResult = {
      score: -0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [choiceEv('move ironhead', 'Iron Head', -0.06, -0.05)],
        p2: [
          choiceEv('move recover', 'Recover', 0.04, 0.05),
          choiceEv('switch 5', '→ Heatran', -0.39, 0.047),
        ],
      },
    };
    const at = (playedOutcome: number | null) => analyzeTurn({
      turn: 50,
      result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome,
      scoreBefore: -0.05,
      scoreAfter: -0.14,
    });

    const paid = at(-0.19);
    expect(paid.p2.tier).toBeUndefined();
    expect(paid.p2.riskPaidOff).toBe(true);
    expect(paid.p2.riskPayoff).toBeCloseTo(0.15, 10);
    expect(paid.p2.riskUnpunished).toBeUndefined();
    expect(paid.attribution).toBe('p2-read');

    const neutral = at(-0.05);
    expect(neutral.p2.riskPaidOff).toBeUndefined();
    expect(neutral.attribution).toBe('quiet');

    const unknown = at(null);
    expect(unknown.p2.riskPaidOff).toBeUndefined();
    expect(unknown.p2.riskUnpunished).toBeUndefined();

    const smallGap: EvalResult = {
      ...tied,
      perSide: {
        p1: tied.perSide.p1,
        p2: [
          choiceEv('move recover', 'Recover', 0.04, 0.05),
          choiceEv('switch 5', '→ Heatran', -0.1, 0.047),
        ],
      },
    };
    const ordinary = analyzeTurn({
      turn: 50, result: smallGap,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome: -0.19, scoreBefore: -0.05, scoreAfter: -0.14,
    });
    expect(ordinary.p2.riskPaidOff).toBeUndefined();

    const delayed = analyzeTurn({
      turn: 50, result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome: -0.05, futureOutcomes: [-0.3, -0.6], scoreBefore: -0.05, scoreAfter: -0.14,
    });
    expect(delayed.p2.riskPaidOff).toBeUndefined();

    const lost: EvalResult = {
      ...tied,
      score: 0.75,
      perSide: {
        p1: [choiceEv('move ironhead', 'Iron Head', 0.7, 0.72)],
        p2: [
          choiceEv('move recover', 'Recover', -0.6, -0.58),
          choiceEv('switch 5', '→ Heatran', -0.95, -0.59),
        ],
      },
    };
    const garbage = analyzeTurn({
      turn: 60, result: lost,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome: 0.4, scoreBefore: 0.75, scoreAfter: 0.3,
    });
    expect(garbage.p2.riskPaidOff).toBeUndefined();

    const gambleBest: EvalResult = {
      ...tied,
      perSide: {
        p1: tied.perSide.p1,
        p2: [
          choiceEv('switch 5', '→ Heatran', -0.39, 0.06),
          choiceEv('move recover', 'Recover', 0.04, 0.05),
        ],
      },
    };
    const enginePick = analyzeTurn({
      turn: 50, result: gambleBest,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome: -0.19, scoreBefore: -0.05, scoreAfter: -0.14,
    });
    expect(enginePick.p2.riskPaidOff).toBeUndefined();
  });

  test('a swallowed choice carries its protocol reason and keeps the engine line', () => {
    const analysis = analyzeTurn({
      turn: 32,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: null, prevented: { p2: 'slp' } },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.p2.prevented).toBe('slp');
    expect(analysis.p2.played).toBeNull();
    expect(analysis.p2.best).toBeTruthy();
  });

  test('regret is measured against equilibrium EV, not the floor', () => {
    const evResult: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          choiceEv('move aggro', 'Aggro', 0.0, 0.15),
          choiceEv('move bold', 'Bold', -0.3, 0.1),
        ],
        p2: [choiceEv('move x', 'X', 0.0, 0.0)],
      },
    };
    const analysis = analyzeTurn({
      turn: 3,
      result: evResult,
      played: { p1: { kind: 'move', name: 'Bold', tera: false }, p2: { kind: 'move', name: 'X', tera: false } },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.p1.regret).toBeCloseTo(0.05, 10);
    expect(analysis.attribution).toBe('quiet');
  });

  test('the safe line is the max-floor entry even when it is not best-by-ev', () => {
    const evResult: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          choiceEv('move aggro', 'Aggro', -0.2, 0.3),
          choiceEv('move careful', 'Careful', 0.05, 0.05),
          choiceEv('move bold', 'Bold', -0.3, -0.2),
        ],
        p2: [choiceEv('move x', 'X', 0.0, 0.0)],
      },
    };
    const analysis = analyzeTurn({
      turn: 4,
      result: evResult,
      played: { p1: { kind: 'move', name: 'Bold', tera: false }, p2: { kind: 'move', name: 'X', tera: false } },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.p1.best?.choice).toBe('move aggro');
    expect(analysis.p1.safe?.choice).toBe('move careful');
    expect(analysis.p1.regret).toBeCloseTo(0.5, 10);
  });

  test('a flinched slot still grades charitably against consistent combos', () => {
    const doublesResult: EvalResult = {
      score: 0, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice('move tackle 1, move protect', 'Tackle + Protect', 0.1)],
        p2: [
          choice('move protect, move drainpunch 1', 'Protect + Drain Punch', 0.05),
          choice('move rockslide, move ragefist 1', 'Rock Slide + Rage Fist', -0.1),
          choice('move rockslide, move drainpunch 1', 'Rock Slide + Drain Punch', -0.3),
        ],
      },
    };
    const analysis = analyzeTurn({
      turn: 5,
      result: doublesResult,
      played: {
        p1: null, p2: null,
        p1Slots: [
          { kind: 'move', name: 'Tackle', targetLoc: 1 },
          { kind: 'move', name: 'Protect', targetLoc: null },
        ],
        p2Slots: [{ kind: 'move', name: 'Rock Slide', targetLoc: null }, null],
      },
      playedOutcome: null,
      scoreBefore: 0,
      scoreAfter: null,
    });
    expect(analysis.p2.played?.choice).toBe('move rockslide, move ragefist 1');
    expect(analysis.p2.playedPartial).toBe(true);
    expect(analysis.p2.regret).toBeCloseTo(0.15, 10);
    expect(analysis.p1.played?.choice).toBe('move tackle 1, move protect');
    expect(analysis.p1.playedPartial).toBeUndefined();
  });

  test('fully hidden turns still grade nothing', () => {
    const doublesResult: EvalResult = {
      score: 0, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice('move tackle 1, move protect', 'Tackle + Protect', 0.1)],
        p2: [choice('move rockslide, move ragefist 1', 'Rock Slide + Rage Fist', -0.1)],
      },
    };
    const analysis = analyzeTurn({
      turn: 6,
      result: doublesResult,
      played: { p1: null, p2: null, p1Slots: [null, null], p2Slots: [null, null] },
      playedOutcome: null,
      scoreBefore: 0,
      scoreAfter: null,
    });
    expect(analysis.p1.played).toBeNull();
    expect(analysis.p1.playedPartial).toBeUndefined();
    expect(analysis.p2.played).toBeNull();
  });

  test('regret bands into inaccuracy, mistake, and blunder tiers', () => {
    const at = (playedEv: number, scoreBefore = 0) => analyzeTurn({
      turn: 7,
      result: {
        score: scoreBefore, interval: 0, depthCompleted: 1,
        perSide: {
          p1: [
            choiceEv('move aggro', 'Aggro', 0.4, 0.4),
            choiceEv('move bold', 'Bold', playedEv, playedEv),
          ],
          p2: [choiceEv('move x', 'X', 0.0, 0.0)],
        },
      },
      played: { p1: { kind: 'move', name: 'Bold', tera: false }, p2: { kind: 'move', name: 'X', tera: false } },
      playedOutcome: null,
      scoreBefore,
      scoreAfter: null,
    });
    expect(at(0.28).p1.tier).toBe('inaccuracy');
    expect(at(0.28).attribution).toBe('quiet');
    expect(at(0.2).p1.tier).toBe('mistake');
    expect(at(0.2).attribution).toBe('p1-decision');
    expect(at(-0.05).p1.tier).toBe('blunder');
    expect(at(0.38).p1.tier).toBeUndefined();
  });

  test('a decided position softens the verdict a tier', () => {
    const at = (playedEv: number, scoreBefore: number) => analyzeTurn({
      turn: 8,
      result: {
        score: scoreBefore, interval: 0, depthCompleted: 1,
        perSide: {
          p1: [
            choiceEv('move aggro', 'Aggro', 0.4, 0.4),
            choiceEv('move bold', 'Bold', playedEv, playedEv),
          ],
          p2: [choiceEv('move x', 'X', 0.0, 0.0)],
        },
      },
      played: { p1: { kind: 'move', name: 'Bold', tera: false }, p2: { kind: 'move', name: 'X', tera: false } },
      playedOutcome: null,
      scoreBefore,
      scoreAfter: null,
    });
    expect(at(0.2, -0.8).p1.tier).toBe('inaccuracy');
    expect(at(0.2, -0.8).attribution).toBe('quiet');
    expect(at(-0.05, -0.8).p1.tier).toBe('mistake');
    expect(at(-0.05, -0.8).attribution).toBe('p1-decision');
    expect(at(0.2, 0.3).p1.tier).toBe('mistake');
  });

  test('a deeper verification pass can clear a flagged misplay', () => {
    const at = (verified?: { p2?: { playedDeep: number; bestDeep: number } }) => analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      verified,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    });
    const cleared = at({ p2: { playedDeep: -0.1, bestDeep: -0.15 } });
    expect(cleared.p2.regret).toBeCloseTo(0.05, 10);
    expect(cleared.p2.verifiedAtDepth).toBe(true);
    expect(cleared.p2.riskUnpunished).toBeUndefined();
    expect(cleared.attribution).toBe('chance');
    const confirmed = at({ p2: { playedDeep: 0.2, bestDeep: -0.1 } });
    expect(confirmed.p2.regret).toBeCloseTo(0.25, 10);
    expect(confirmed.p2.verifiedAtDepth).toBeUndefined();
    expect(confirmed.attribution).toBe('p2-decision');
  });

  test('a read may cash in over the following turns, not just one', () => {
    const at = (futureOutcomes?: (number | null)[]) => analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      futureOutcomes,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    });
    // Immediate payoff +0.05 is neutral; the expected line two turns out
    // (own +0.30 vs the safe floor −0.05) banks +0.35: the read paid off.
    const paid = at([-0.3, -0.28]);
    expect(paid.p2.riskPaidOff).toBe(true);
    expect(paid.p2.riskPayoff).toBeCloseTo(0.35, 10);
    expect(paid.p2.riskPayoffTurn).toBe(1);
    expect(paid.attribution).toBe('p2-read');
    const neutral = at(undefined);
    expect(neutral.p2.riskUnpunished).toBe(true);
    expect(neutral.p2.riskPaidOff).toBeUndefined();
    expect(neutral.p2.riskPayoffTurn).toBeUndefined();
  });

  test('best moves on both sides with a big residual is a chance swing', () => {
    const analysis = analyzeTurn({
      turn: 8,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.15,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
    });
    expect(analysis.attribution).toBe('chance');
    expect(analysis.chanceDelta).toBeCloseTo(-0.55, 10);
  });

  test('a big swing with no culprit is a shift, not a quiet turn', () => {
    const analysis = analyzeTurn({
      turn: 19,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.21,
      scoreBefore: 0.1,
      scoreAfter: 0.35,
    });
    expect(analysis.attribution).toBe('shift');
    expect(analysis.decisionDelta).toBeCloseTo(0.11, 10);
    expect(analysis.chanceDelta).toBeCloseTo(0.14, 10);
  });

  test('without played tracking (doubles) only shift/quiet are possible', () => {
    const big = analyzeTurn({
      turn: 5,
      result,
      played: null,
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
      playedTracking: false,
    });
    expect(big.attribution).toBe('shift');
    expect(big.playedTracking).toBe(false);
    expect(big.p1.best?.choice).toBe('move dracometeor');

    const small = analyzeTurn({
      turn: 6,
      result,
      played: null,
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: 0.15,
      playedTracking: false,
    });
    expect(small.attribution).toBe('quiet');
  });

  test('small regrets and small residual is quiet', () => {
    const analysis = analyzeTurn({
      turn: 3,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.12,
      scoreBefore: 0.1,
      scoreAfter: 0.15,
    });
    expect(analysis.attribution).toBe('quiet');
  });

  test('an unmatched action with a big swing is unclear, not blamed', () => {
    const analysis = analyzeTurn({
      turn: 11,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: null },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.5,
    });
    expect(analysis.p2.played).toBeNull();
    expect(analysis.attribution).toBe('unclear');
    expect(analysis.chanceDelta).toBeNull();
  });

  test('the last analyzed turn (no next score) still reports regrets', () => {
    const analysis = analyzeTurn({
      turn: 30,
      result,
      played: { p1: { kind: 'move', name: 'U-turn', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.swing).toBeNull();
    expect(analysis.p1.regret).toBeCloseTo(0.15, 10);
    expect(analysis.p2.regret).toBeCloseTo(0.25, 10);
    expect(analysis.p2.regret).toBeGreaterThanOrEqual(REGRET_THRESHOLD);
    expect(analysis.attribution).toBe('p2-decision');
  });
});

describe('doubles combined matching', () => {
  const combined: EvalResult = {
    score: 0.1,
    interval: 0,
    depthCompleted: 1,
    perSide: {
      p1: [
        choice('move moonblast 2, move fakeout 1', 'Moonblast→Chien-Pao + Fake Out→Incineroar', 0.3),
        choice('move moonblast 1, switch 3', 'Moonblast→Incineroar + → Amoonguss', 0.1),
        choice('move dazzlinggleam, move fakeout 1 terastallize', 'Dazzling Gleam + Tera + Fake Out→Incineroar', 0.0),
      ],
      p2: [],
    },
  };

  test('matches per-slot moves with targets, spreads, tera, and switches', async () => {
    const { matchPlayedSide } = await import('../src/analysis');
    const match = (slots: import('../src/played').PlayedTurn['p1Slots']) =>
      matchPlayedSide(combined, 'p1', { p1: null, p2: null, p1Slots: slots })?.choice ?? null;

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 2 },
      { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 },
    ])).toBe('move moonblast 2, move fakeout 1');

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
      { kind: 'switch', name: 'Mushy', species: 'Amoonguss' },
    ])).toBe('move moonblast 1, switch 3');

    expect(match([
      { kind: 'move', name: 'Dazzling Gleam', tera: false, targetLoc: 1 },
      { kind: 'move', name: 'Fake Out', tera: true, targetLoc: 1 },
    ])).toBe('move dazzlinggleam, move fakeout 1 terastallize');

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
      { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 },
    ])).toBeNull();
    expect(match([null, { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 }]))
      .toBe('move moonblast 2, move fakeout 1');
  });

  test('analyzeTurn computes doubles regret from the matched combo', async () => {
    const analysis = analyzeTurn({
      turn: 4,
      result: combined,
      played: {
        p1: null, p2: null,
        p1Slots: [
          { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
          { kind: 'switch', name: 'Mushy', species: 'Amoonguss' },
        ],
        p2Slots: [null, null],
      },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.p1.played?.choice).toBe('move moonblast 1, switch 3');
    expect(analysis.p1.regret).toBeCloseTo(0.2, 10);
    expect(analysis.p1.playedSlots).toHaveLength(2);
  });
});

describe('choice diffing (the condensed why)', () => {
  const ranked = (choiceStr: string, label: string): RankedChoice => choice(choiceStr, label, 0);

  test('a skipped gimmick names the gimmick alone', async () => {
    const { diffChoices } = await import('../src/analysis');
    expect(diffChoices(
      ranked('move bugbite 1, move closecombat 1', 'Bug Bite→Politoed + Close Combat→Politoed'),
      ranked('move bugbite 1 mega, move closecombat 1', 'Mega + Bug Bite→Politoed + Close Combat→Politoed'),
    )).toBe('only the Mega Evolution');
    expect(diffChoices(
      ranked('move freezedry', 'Freeze-Dry'),
      ranked('move freezedry terastallize', 'Tera + Freeze-Dry'),
    )).toBe('only the Terastallization');
  });

  test('a target-only difference names the move', async () => {
    const { diffChoices } = await import('../src/analysis');
    expect(diffChoices(
      ranked('move closecombat 1, move protect', 'Close Combat→Politoed + Protect'),
      ranked('move closecombat 2, move protect', 'Close Combat→Incineroar + Protect'),
    )).toBe('only the target of Close Combat');
  });

  test('one differing doubles slot condenses; a singles whole-action does not', async () => {
    const { diffChoices } = await import('../src/analysis');
    expect(diffChoices(
      ranked('move protect, move surf 1', 'Protect + Surf→Incineroar'),
      ranked('move protect, switch 3', 'Protect + → Amoonguss'),
    )).toBe('switching to Amoonguss instead of Surf→Incineroar');
    expect(diffChoices(
      ranked('move recover', 'Recover'),
      ranked('switch 3', '→ Dragapult'),
    )).toBeNull();
  });

  test('more than one difference stays uncondensed', async () => {
    const { diffChoices } = await import('../src/analysis');
    expect(diffChoices(
      ranked('move bugbite 1, move closecombat 1', 'Bug Bite→Politoed + Close Combat→Politoed'),
      ranked('move bugbite 2 mega, switch 3', 'Mega + Bug Bite→Incineroar + → Amoonguss'),
    )).toBeNull();
  });
});

describe('pivot pair matching', () => {
  const options = [
    { choice: 'move uturn > switch 2', label: 'U-turn → Noivern' },
    { choice: 'move uturn > switch 3', label: 'U-turn → Clefable' },
    { choice: 'move closecombat', label: 'Close Combat' },
  ];

  test('a known pivot target matches the exact pair row', () => {
    const matched = findPlayedOption(options, [
      { kind: 'move', name: 'U-turn', pivotTarget: 'Clefable' },
    ]);
    expect(matched?.label).toBe('U-turn → Clefable');
  });

  test('an unknown pivot target takes the best-ranked pair of the move', () => {
    const matched = findPlayedOption(options, [{ kind: 'move', name: 'U-turn' }]);
    expect(matched?.label).toBe('U-turn → Noivern');
  });

  test('the singles match reads the pair rows too (draft t1: U-turn → Kyurem stood alone)', () => {
    const pairResult: EvalResult = { score: 0, interval: 0, depthCompleted: 1,
      perSide: { p1: options.map(option => choice(option.choice, option.label, 0)), p2: [] } };
    const uturn = (pivotTarget?: string) => ({ kind: 'move' as const, name: 'U-turn', tera: false, pivotTarget });
    expect(matchPlayedChoice(pairResult, 'p1', uturn('Clefable'))?.label).toBe('U-turn → Clefable');
    expect(matchPlayedChoice(pairResult, 'p1', uturn())?.label).toBe('U-turn → Noivern');
    expect(matchPlayedChoice(pairResult, 'p1', { kind: 'move', name: 'Close Combat', tera: false })?.label).toBe('Close Combat');
  });
});

describe('narrative signals', () => {
  const conditionalResult = (p2Choices?: string[]): EvalResult => ({
    score: 0.05, interval: 0.02, depthCompleted: 1,
    perSide: {
      p1: [choiceEv('move ironhead', 'Iron Head', 0.02, 0.05), choiceEv('move earthpower', 'Earth Power', 0.02, 0.04)],
      p2: [
        choiceEv('move recover', 'Recover', -0.1, -0.05),
        choiceEv('switch 5', '→ Heatran', -0.4, -0.06),
        choiceEv('move splash', 'Splash', -0.5, -0.35),
      ],
    },
    matrix: {
      p1Labels: ['Iron Head', 'Earth Power'],
      p2Labels: ['Recover', '→ Heatran', 'Splash'],
      p1Choices: ['move ironhead', 'move earthpower'],
      ...(p2Choices ? { p2Choices } : {}),
      values: [
        [0.05, 0.02, 0.30],
        [0.10, 0.40, 0.35],
      ],
      mixes: { p1: [0.5, 0.5], p2: [0.11, 0.89, 0] },
    },
  });
  const conditionalParams = (result: EvalResult) => ({
    turn: 7,
    result,
    played: {
      p1: { kind: 'move' as const, name: 'Iron Head', tera: false },
      p2: { kind: 'move' as const, name: 'Splash', tera: false },
    },
    playedOutcome: 0.0,
    scoreBefore: 0.05,
    scoreAfter: 0.3,
  });

  test('viableCount counts options within an inaccuracy of best', () => {
    const analysis = analyzeTurn(conditionalParams(conditionalResult()));
    expect(analysis.p1.viableCount).toBe(2);
    expect(analysis.p2.viableCount).toBe(2);
  });

  test('a tiered side whose equilibrium leans another choice gets the conditional', () => {
    const analysis = analyzeTurn(conditionalParams(
      conditionalResult(['move recover', 'switch 5', 'move splash'])));
    expect(analysis.p2.tier).toBe('mistake');
    expect(analysis.p2.conditional).toEqual({
      mixLabel: '→ Heatran',
      mixWeight: 0.89,
      // Own-perspective (p2) diffs best−mix: vs Iron Head −0.03 (mix covers it),
      // vs Earth Power +0.30 (best only pays there).
      bestWhen: 'Earth Power',
      mixWhen: 'Iron Head',
    });
  });

  test('the conditional fails closed without machine choice ids', () => {
    const analysis = analyzeTurn(conditionalParams(conditionalResult()));
    expect(analysis.p2.conditional).toBeUndefined();
  });

  test('an untiered side never carries a conditional', () => {
    const result = conditionalResult(['move recover', 'switch 5', 'move splash']);
    const clean = analyzeTurn({
      ...conditionalParams(result),
      played: {
        p1: { kind: 'move' as const, name: 'Iron Head', tera: false },
        p2: { kind: 'move' as const, name: 'Recover', tera: false },
      },
    });
    expect(clean.p2.tier).toBeUndefined();
    expect(clean.p2.conditional).toBeUndefined();
  });

  test('a near-pure equilibrium switch is named as forced; move tops are not', () => {
    const forced = conditionalResult(['move recover', 'switch 5', 'move splash']);
    forced.matrix!.mixes.p2 = [0.05, 0.92, 0.03];
    const analysis = analyzeTurn(conditionalParams(forced));
    expect(analysis.p2.forcedMix).toEqual({ label: '→ Heatran', weight: 0.92 });
    expect(analysis.p1.forcedMix).toBeUndefined();

    const moveTop = conditionalResult(['move recover', 'switch 5', 'move splash']);
    moveTop.matrix!.mixes.p2 = [0.92, 0.05, 0.03];
    expect(analyzeTurn(conditionalParams(moveTop)).p2.forcedMix).toBeUndefined();
  });

  test('the matrix names the hindsight read against the opponent\'s actual click', () => {
    const analysis = analyzeTurn(conditionalParams(
      conditionalResult(['move recover', 'switch 5', 'move splash'])));
    // p2 vs the Iron Head actually clicked (column 0, own-p2): Recover −0.05,
    // → Heatran −0.02, the played Splash −0.30: the read was worth 0.28.
    expect(analysis.p2.hindsightRead).toBeDefined();
    expect(analysis.p2.hindsightRead!.response).toBe('→ Heatran');
    expect(analysis.p2.hindsightRead!.against).toBe('Iron Head');
    expect(analysis.p2.hindsightRead!.gain).toBeCloseTo(0.28, 10);
    expect(analysis.p1.hindsightRead).toBeUndefined();
  });

  test('the hindsight read fails closed without machine choice ids', () => {
    const analysis = analyzeTurn(conditionalParams(conditionalResult()));
    expect(analysis.p2.hindsightRead).toBeUndefined();
  });

  test('a switch into an unanswered mon carries the entry-is-profit signal', () => {
    const result = conditionalResult(['move recover', 'switch 5', 'move splash']);
    result.unanswered = { p1: [], p2: ['Heatran'] };
    const analysis = analyzeTurn({
      ...conditionalParams(result),
      played: {
        p1: { kind: 'move' as const, name: 'Iron Head', tera: false },
        p2: { kind: 'switch' as const, name: 'Heaty', species: 'Heatran' },
      },
    });
    expect(analysis.p2.unanswered).toEqual({ species: 'Heatran' });
    expect(analysis.p1.unanswered).toBeUndefined();

    const off = conditionalResult(['move recover', 'switch 5', 'move splash']);
    off.unanswered = { p1: [], p2: ['Blissey'] };
    const quiet = analyzeTurn({
      ...conditionalParams(off),
      played: {
        p1: { kind: 'move' as const, name: 'Iron Head', tera: false },
        p2: { kind: 'switch' as const, name: 'Heaty', species: 'Heatran' },
      },
    });
    expect(quiet.p2.unanswered).toBeUndefined();
  });

  test('a switch into a held mon names the standing holder', () => {
    const result = conditionalResult(['move recover', 'switch 5', 'move splash']);
    result.unanswered = { p1: [], p2: [], p2Entry: [{ species: 'Heatran', heldBy: 'Skarmory' }] };
    const analysis = analyzeTurn({
      ...conditionalParams(result),
      played: {
        p1: { kind: 'move' as const, name: 'Iron Head', tera: false },
        p2: { kind: 'switch' as const, name: 'Heaty', species: 'Heatran' },
      },
    });
    expect(analysis.p2.unanswered).toEqual({ species: 'Heatran', heldBy: 'Skarmory' });
  });

  test('the report walk speaks each stage once per mon', () => {
    const spoken = conditionalResult(['move recover', 'switch 5', 'move splash']);
    spoken.unanswered = { p1: [], p2: ['Heatran'] };
    const params = {
      ...conditionalParams(spoken),
      played: {
        p1: { kind: 'move' as const, name: 'Iron Head', tera: false },
        p2: { kind: 'switch' as const, name: 'Heaty', species: 'Heatran' },
      },
    };
    const muted = analyzeTurn({
      ...params,
      unansweredSeen: new Set([unansweredSeenKey('p2', { species: 'Heatran' })]),
    });
    expect(muted.p2.unanswered).toBeUndefined();

    const other = analyzeTurn({
      ...params,
      unansweredSeen: new Set([unansweredSeenKey('p2', { species: 'Heatran', heldBy: 'Skarmory' })]),
    });
    expect(other.p2.unanswered).toEqual({ species: 'Heatran' });
  });

  test('a mechanically null best names its reason and a co-optimal alternative', () => {
    const wisp: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          choiceEv('move willowisp', 'Will-O-Wisp', 0.1, 0.2),
          choiceEv('move hex', 'Hex', 0.08, 0.19),
          choiceEv('move splash', 'Splash', -0.5, -0.3),
        ],
        p2: [choice('move flareblitz', 'Flare Blitz', -0.1)],
      },
    };
    const at = (actives?: { p1: string | null; p2: string | null; gen: number }) => analyzeTurn({
      turn: 19,
      result: wisp,
      played: { p1: { kind: 'move', name: 'Splash', tera: false }, p2: { kind: 'move', name: 'Flare Blitz', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.2,
      ...(actives ? { actives } : {}),
    });
    const flagged = at({ p1: 'Mew', p2: 'Charizard-Mega-X', gen: 6 });
    expect(flagged.p1.bestNull?.reason).toContain('cannot be burned');
    expect(flagged.p1.bestNull?.alternative).toEqual({ label: 'Hex', ev: 0.19 });
    expect(at().p1.bestNull).toBeUndefined();
  });

  test('a null best without a co-optimal survivor keeps alternative null', () => {
    const lonely: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          choiceEv('move willowisp', 'Will-O-Wisp', 0.1, 0.2),
          choiceEv('move splash', 'Splash', -0.5, -0.3),
        ],
        p2: [choice('move flareblitz', 'Flare Blitz', -0.1)],
      },
    };
    const analysis = analyzeTurn({
      turn: 19,
      result: lonely,
      played: { p1: { kind: 'move', name: 'Splash', tera: false }, p2: { kind: 'move', name: 'Flare Blitz', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.2,
      actives: { p1: 'Mew', p2: 'Charizard-Mega-X', gen: 6 },
    });
    expect(analysis.p1.bestNull?.reason).toContain('cannot be burned');
    expect(analysis.p1.bestNull?.alternative).toBeNull();
  });

  test('the null-guard alternative forwards its koOdds grounding', () => {
    const wisp: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          choiceEv('move willowisp', 'Will-O-Wisp', 0.1, 0.2),
          { ...choiceEv('move hex', 'Hex', 0.08, 0.19), koOdds: { accuracy: 0.9, killFraction: 0.5 } },
          choiceEv('move splash', 'Splash', -0.5, -0.3),
        ],
        p2: [choice('move flareblitz', 'Flare Blitz', -0.1)],
      },
    };
    const analysis = analyzeTurn({
      turn: 19,
      result: wisp,
      played: { p1: { kind: 'move', name: 'Splash', tera: false }, p2: { kind: 'move', name: 'Flare Blitz', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.2,
      actives: { p1: 'Mew', p2: 'Charizard-Mega-X', gen: 6 },
    });
    expect(analysis.p1.bestNull?.alternative)
      .toEqual({ label: 'Hex', ev: 0.19, koOdds: { accuracy: 0.9, killFraction: 0.5 } });
  });

  test('streak odds detect from the played history and fail closed without it', () => {
    const historyEntry = () => ({
      attacker: 'Kyurem', moveId: 'icebeam', defender: 'Blissey', movedFirst: true,
      attackerAbility: 'pressure', defenderAbility: 'naturalcure', defenderItem: 'leftovers',
      defenderBoosts: { def: 0, spd: 0 },
    });
    const withHistory = analyzeTurn({
      ...conditionalParams(conditionalResult()),
      turn: 3,
      actives: { p1: 'Kyurem', p2: 'Blissey', gen: 6 },
      playedHistory: { p1: [historyEntry(), historyEntry(), historyEntry()], p2: [null, null, null] },
    });
    expect(withHistory.p1.streakOdds?.event).toBe('freeze');
    expect(withHistory.p1.streakOdds?.n).toBe(3);
    expect(withHistory.p2.streakOdds).toBeUndefined();
    const without = analyzeTurn({
      ...conditionalParams(conditionalResult()),
      actives: { p1: 'Kyurem', p2: 'Blissey', gen: 6 },
    });
    expect(without.p1.streakOdds).toBeUndefined();
  });
});

describe('the decided sweep at the analysis layer', () => {
  const decidedResult = (score = -0.8): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move tackle', 'Tackle', -0.2)],
      p2: [choice('move stompingtantrum', 'Stomping Tantrum', 0.2)],
    },
    unanswered: { p1: [], p2: ['Zapdos-Galar'], decided: { side: 'p2', species: 'Zapdos-Galar' } },
  });
  const at = (extra?: { result?: EvalResult; decidedSeen?: ReadonlySet<string> }) => analyzeTurn({
    turn: 134,
    result: decidedResult(),
    played: {
      p1: { kind: 'move' as const, name: 'Tackle', tera: false },
      p2: { kind: 'move' as const, name: 'Stomping Tantrum', tera: false },
    },
    playedOutcome: -0.2,
    scoreBefore: -0.2,
    scoreAfter: -0.85,
    ...extra,
  });

  test('the decided sweep attaches to its owning side and announces once', () => {
    const analysis = at();
    expect(analysis.p2.decided).toEqual({ species: 'Zapdos-Galar', announce: true });
    expect(analysis.p1.decided).toBeUndefined();
    const spoken = at({ decidedSeen: new Set([decidedSeenKey('p2', { species: 'Zapdos-Galar' })]) });
    expect(spoken.p2.decided).toEqual({ species: 'Zapdos-Galar', announce: false });
  });

  test('the near-decided roll carries odds and target, keyed apart from decided', () => {
    const nearResult = (): EvalResult => {
      const result = decidedResult(-0.2);
      result.unanswered = {
        p1: [], p2: [],
        nearDecided: { side: 'p2', species: 'Garchomp', odds: 0.95, removes: 'Corviknight' },
      };
      return result;
    };
    const analysis = at({ result: nearResult() });
    expect(analysis.p2.nearDecided).toEqual({
      species: 'Garchomp', odds: 0.95, removes: 'Corviknight', announce: true,
    });
    expect(analysis.p2.decided).toBeUndefined();
    const other = at({
      result: nearResult(),
      decidedSeen: new Set([decidedSeenKey('p2', { species: 'Garchomp' })]),
    });
    expect(other.p2.nearDecided?.announce).toBe(true);
    const muted = at({
      result: nearResult(),
      decidedSeen: new Set([decidedSeenKey('p2', { species: 'Garchomp', removes: 'Corviknight' })]),
    });
    expect(muted.p2.nearDecided?.announce).toBe(false);
  });
});
