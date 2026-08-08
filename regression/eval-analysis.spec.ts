import { test, expect } from '@playwright/test';
import { analyzeTurn, matchPlayedChoice, playedSetupMove, REGRET_THRESHOLD, type SideAnalysis } from '../src/lib/eval/analysis';
import { allTurnEvents, detectSacks, turnEvents } from '../src/lib/eval/played';
import type { EvalResult, RankedChoice } from '../src/lib/eval/types';
import type { TurnSnapshot } from '../src/types';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

/** A choice whose floor and equilibrium EV diverge — the ev-grading cases. */
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

test.describe('verdict tiers in wp-units', () => {
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
    expect(at(0.5 - 0.17)).toBe('inaccuracy'); // 8.5% loss — old bands called this a mistake
    expect(at(0.5 - 0.25)).toBe('mistake');
    expect(at(0.5 - 0.35)).toBe('mistake');    // old bands called this a blunder
    expect(at(0.5 - 0.45)).toBe('blunder');
    expect(at(0.5 - 0.05)).toBeUndefined();
  });
});

test.describe('read-aware risk phrasing', () => {
  test('a risk matching the read is marked as a read on tendencies', () => {
    const at = (readLabel?: string) => analyzeTurn({
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
              choice: { label: readLabel, ev: 0.1, worstCase: -0.3 },
              net: 0.1, confidence: 0.7,
              breakdown: [],
            },
          },
        }
        : {}),
    });
    // Recover is an unpunished risk (regret 0.25); when the opponent model's
    // best response IS Recover, the risk was a read.
    expect(at().p2.riskUnpunished).toBe(true);
    expect(at().p2.riskWasRead).toBeFalsy();
    expect(at('Recover').p2.riskWasRead).toBe(true);
    expect(at('→ Dragapult').p2.riskWasRead).toBeFalsy();
  });
});

test.describe('sacrifice detection', () => {
  test('turnEvents slices the lines strictly between turn markers', () => {
    const log = ['|start', '|turn|1', '|move|a', '|turn|2', '|move|b', '|win|X'].join('\n');
    expect(turnEvents(log, 1)).toEqual(['|move|a']);
    expect(turnEvents(log, 2)).toEqual(['|move|b', '|win|X']);
    expect(turnEvents(log, 3)).toEqual([]);
    // The one-pass index slices identically.
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
    expect(detectSacks(events, sackSnapshot(9))).toEqual({ p1: { name: 'Dauni', hpFraction: 0.09 } });
    expect(detectSacks(events, sackSnapshot(45))).toEqual({});
    expect(detectSacks(events, null)).toEqual({});
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
    // Regret 0.2 = mistake; the sack demotes one band and replaces the risk label.
    expect(analysis.p1.sacrifice).toEqual({ name: 'Uxie', hpFraction: 0.09 });
    expect(analysis.p1.tier).toBe('inaccuracy');
    expect(analysis.p1.riskUnpunished).toBeFalsy();
  });

  test('a blunder-sized throw is not forgiven by the sack label', () => {
    // Sacking the nearly-dead mon can still be the wrong play: when the
    // regret reaches the blunder band, the sack leniency must not apply.
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
    // Regret 0.45 = blunder band: tier and grading stay, no neutral sack framing.
    expect(analysis.p1.tier).toBe('blunder');
    expect(analysis.p1.sacrifice).toBeUndefined();
  });
});

test.describe('turn analysis assembly', () => {
  test('matches moves, tera variants, and switches (nickname or species)', () => {
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Draco Meteor', tera: false })?.choice).toBe('move dracometeor');
    expect(matchPlayedChoice(result, 'p2', { kind: 'move', name: 'Freeze-Dry', tera: true })?.choice).toBe('move freezedry terastallize');
    expect(matchPlayedChoice(result, 'p2', { kind: 'switch', name: 'Draggy', species: 'Dragapult' })?.label).toBe('→ Dragapult');
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Unknown Move', tera: false })).toBeNull();
  });

  test('a side that played a clearly worse option gets the decision blame', () => {
    // playedOutcome 0.0 keeps p2's payoff (+0.05 over the safe floor −0.05)
    // inside the neutral band — an unpunished risk, still a decision turn.
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

    // Own outcome +0.2 vs safe floor −0.05: the read won +0.25 — a good play.
    const paid = at(-0.2);
    expect(paid.p2.riskUnpunished).toBe(true);
    expect(paid.p2.riskPaidOff).toBe(true);
    expect(paid.p2.riskPayoff).toBeCloseTo(0.25, 10);
    expect(paid.attribution).toBe('p2-read');
    expect(paid.p1.riskUnpunished).toBeUndefined();

    // Payoff +0.05 sits in the neutral band: risk, not a good play yet.
    const neutral = at(0.0);
    expect(neutral.p2.riskUnpunished).toBe(true);
    expect(neutral.p2.riskPaidOff).toBeUndefined();
    expect(neutral.attribution).toBe('p2-decision');

    // Own outcome −0.2 vs floor −0.05: worse than the safe guarantee even
    // with the read coming true — a plain misplay.
    const behind = at(0.2);
    expect(behind.p2.riskUnpunished).toBeUndefined();
    expect(behind.attribution).toBe('p2-decision');

    // Unknown pair value: the risk stays a risk.
    const unknown = at(null);
    expect(unknown.p2.riskUnpunished).toBe(true);
    expect(unknown.p2.riskPaidOff).toBeUndefined();

    // When the opponent DID click the punisher, no flag at all.
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

  test('regret is measured against equilibrium EV, not the floor', () => {
    // The played line has a scary floor (−0.3) but nearly full equilibrium
    // value: floor-regret would cry 0.3 — the honest ev-regret is 0.05.
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
    // p2 slot b flinched (|cant| settles it as null): the combo can't match
    // exactly, but Rock Slide was observed — grade against the BEST combo the
    // visible slot still allows, never blaming the hidden choice.
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
    // Fully observed p1 matches exactly — no partial flag.
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
    // Already lost (own −0.8): the 0.2 mistake reads as an inaccuracy and
    // stops driving the attribution; the 0.45 blunder softens to a mistake.
    expect(at(0.2, -0.8).p1.tier).toBe('inaccuracy');
    expect(at(0.2, -0.8).attribution).toBe('quiet');
    expect(at(-0.05, -0.8).p1.tier).toBe('mistake');
    expect(at(-0.05, -0.8).attribution).toBe('p1-decision');
    // Undecided positions keep the full tier.
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
    // Shallow regret 0.25 flags Recover; at depth+1 the played pair is only
    // 0.05 (own) behind the best pair — the verdict is cleared.
    const cleared = at({ p2: { playedDeep: -0.1, bestDeep: -0.15 } });
    expect(cleared.p2.regret).toBeCloseTo(0.05, 10);
    expect(cleared.p2.verifiedAtDepth).toBe(true);
    expect(cleared.p2.riskUnpunished).toBeUndefined();
    expect(cleared.attribution).toBe('chance');
    // The deep pass confirming the gap keeps the shallow equilibrium regret.
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
    // (own +0.30 vs the safe floor −0.05) banks +0.35 — the read paid off.
    const paid = at([-0.3, -0.28]);
    expect(paid.p2.riskPaidOff).toBe(true);
    expect(paid.p2.riskPayoff).toBeCloseTo(0.35, 10);
    expect(paid.p2.riskPayoffTurn).toBe(1);
    expect(paid.attribution).toBe('p2-read');
    // Without future data the behavior is exactly the old one-turn grading.
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
    // Both sides played the engine's move, and neither the decision part
    // (+0.11) nor the chance part (+0.14) crosses its own threshold — but
    // the total swing (+0.25) is anything but quiet.
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
    expect(big.attribution).toBe('shift'); // never 'unclear' — nothing was mis-parsed
    expect(big.playedTracking).toBe(false);
    expect(big.p1.best?.choice).toBe('move dracometeor'); // engine lines still there

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
    // p1's 0.15 regret (7.5% win prob) sits below the wp-unit mistake band —
    // reported as a number, no longer a decision flag; p2's 0.25 still is.
    expect(analysis.p1.regret).toBeCloseTo(0.15, 10);
    expect(analysis.p2.regret).toBeCloseTo(0.25, 10);
    expect(analysis.p2.regret).toBeGreaterThanOrEqual(REGRET_THRESHOLD);
    expect(analysis.attribution).toBe('p2-decision');
  });
});

test.describe('doubles combined matching', () => {
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
    const { matchPlayedSide } = await import('../src/lib/eval/analysis');
    const match = (slots: import('../src/lib/eval/played').PlayedTurn['p1Slots']) =>
      matchPlayedSide(combined, 'p1', { p1: null, p2: null, p1Slots: slots })?.choice ?? null;

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 2 },
      { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 },
    ])).toBe('move moonblast 2, move fakeout 1');

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
      { kind: 'switch', name: 'Mushy', species: 'Amoonguss' },
    ])).toBe('move moonblast 1, switch 3');

    // Spread part accepts any protocol target; Tera label splits correctly.
    expect(match([
      { kind: 'move', name: 'Dazzling Gleam', tera: false, targetLoc: 1 },
      { kind: 'move', name: 'Fake Out', tera: true, targetLoc: 1 },
    ])).toBe('move dazzlinggleam, move fakeout 1 terastallize');

    // Wrong target → no match (a fully observed combo never matches loosely).
    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
      { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 },
    ])).toBeNull();
    // A prevented slot (null) matches charitably against consistent combos.
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

test.describe('setup-move detection', () => {
  const side = (over: Partial<SideAnalysis>): SideAnalysis =>
    ({ playedRaw: null, played: null, best: null, regret: null, ...over });

  test('singles: the played move is recognized by name', () => {
    expect(playedSetupMove(side({ playedRaw: { kind: 'move', name: 'Swords Dance' } }))).toBe('Swords Dance');
    expect(playedSetupMove(side({ playedRaw: { kind: 'move', name: 'Ice Beam' } }))).toBeNull();
    // A switch to a Pokémon nicknamed after a setup move is not a setup move.
    expect(playedSetupMove(side({ playedRaw: { kind: 'switch', name: 'Curse' } }))).toBeNull();
    expect(playedSetupMove(side({}))).toBeNull();
  });

  test('doubles: any slot clicking a setup move counts', () => {
    expect(playedSetupMove(side({ playedSlots: [null, { kind: 'move', name: 'Dragon Dance' }] }))).toBe('Dragon Dance');
    expect(playedSetupMove(side({ playedSlots: [{ kind: 'move', name: 'Protect' }, { kind: 'move', name: 'Fake Out' }] }))).toBeNull();
  });
});

test.describe('choice diffing (the condensed why)', () => {
  const ranked = (choiceStr: string, label: string): RankedChoice => choice(choiceStr, label, 0);

  test('a skipped gimmick names the gimmick alone', async () => {
    const { diffChoices } = await import('../src/lib/eval/analysis');
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
    const { diffChoices } = await import('../src/lib/eval/analysis');
    expect(diffChoices(
      ranked('move closecombat 1, move protect', 'Close Combat→Politoed + Protect'),
      ranked('move closecombat 2, move protect', 'Close Combat→Incineroar + Protect'),
    )).toBe('only the target of Close Combat');
  });

  test('one differing doubles slot condenses; a singles whole-action does not', async () => {
    const { diffChoices } = await import('../src/lib/eval/analysis');
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
    const { diffChoices } = await import('../src/lib/eval/analysis');
    expect(diffChoices(
      ranked('move bugbite 1, move closecombat 1', 'Bug Bite→Politoed + Close Combat→Politoed'),
      ranked('move bugbite 2 mega, switch 3', 'Mega + Bug Bite→Incineroar + → Amoonguss'),
    )).toBeNull();
  });
});
