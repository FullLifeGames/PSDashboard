import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { detectSacks } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';
import type { TurnSnapshot } from '@fulllifegames/replay-core';

/**
 * Round 40: a body whose own action the dice failed was not fed. 573756
 * t73: LordEnz's +4 Garchomp (11 % HP) moved first, Fire Fang missed,
 * Body Press killed it. The old sack detector read every faint under 15 %
 * as a deliberate low-cost trade ("sacked Penal Battalion").
 */

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const choiceEv = (choiceStr: string, label: string, worstCase: number, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev, punishedBy: 'Reply' });

const sackSnapshot = (hpPercent: number): TurnSnapshot => ({
  turn: 73,
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

describe('a death after the mon\'s own dice-failed action', () => {
  test('detectSacks carries the rolled flag for a miss or a dice |cant|', () => {
    const missed = [
      '|move|p1a: Dauni|Fire Fang|p2a: Wall|[miss]',
      '|-miss|p1a: Dauni|p2a: Wall',
      '|move|p2a: Wall|Body Press|p1a: Dauni',
      '|-damage|p1a: Dauni|0 fnt',
      '|faint|p1a: Dauni',
    ];
    expect(detectSacks(missed, sackSnapshot(11))).toEqual({ p1: { name: 'Dauni', hpFraction: 0.11, rolled: 'miss' } });
    // Older logs carry only the |-miss| line.
    expect(detectSacks(missed.filter(line => !line.includes('[miss]')), sackSnapshot(11)))
      .toEqual({ p1: { name: 'Dauni', hpFraction: 0.11, rolled: 'miss' } });
    // A dice |cant| (full paralysis, flinch, freeze, sleep) is the same shape; Taunt is not dice.
    const paralyzed = ['|cant|p1a: Dauni|par', '|move|p2a: Wall|Body Press|p1a: Dauni', '|-damage|p1a: Dauni|0 fnt', '|faint|p1a: Dauni'];
    expect(detectSacks(paralyzed, sackSnapshot(11))).toEqual({ p1: { name: 'Dauni', hpFraction: 0.11, rolled: 'cant' } });
    const taunted = ['|cant|p1a: Dauni|move: Taunt|Toxic', '|move|p2a: Wall|Body Press|p1a: Dauni', '|-damage|p1a: Dauni|0 fnt', '|faint|p1a: Dauni'];
    expect(detectSacks(taunted, sackSnapshot(11))).toEqual({ p1: { name: 'Dauni', hpFraction: 0.11 } });
    // The opponent's miss says nothing about the fainted mon's own action.
    const theirMiss = ['|move|p2a: Wall|Stone Edge|p1a: Dauni|[miss]', '|-miss|p2a: Wall|p1a: Dauni', '|-damage|p1a: Dauni|0 fnt|[from] Stealth Rock', '|faint|p1a: Dauni'];
    expect(detectSacks(theirMiss, sackSnapshot(11))).toEqual({ p1: { name: 'Dauni', hpFraction: 0.11 } });
    // The stayed shape carries the flag too.
    expect(detectSacks(missed, sackSnapshot(46))).toEqual({ p1: { name: 'Dauni', hpFraction: 0.46, stayed: true, rolled: 'miss' } });
  });

  test('a rolled death with a knock-out chance is no sack; without odds the feed reading stands', () => {
    // The played move would have knocked the target out (95% × 1) and the
    // mon moved first: a hit keeps it alive. The miss killed it, so the
    // low-cost-trade framing is false — the regret grades as played.
    const rolledResult: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [
          choiceEv('move scaleshot', 'Scale Shot', 0.2, 0.2),
          { ...choiceEv('move firefang', 'Fire Fang', 0.0, 0.0), koOdds: { accuracy: 0.95, killFraction: 1 } },
        ],
        p2: [choice('move bodypress', 'Body Press', -0.05)],
      },
    };
    const run = (sack: { name: string; hpFraction: number; rolled?: 'miss' | 'cant' }, koOdds = true) => analyzeTurn({
      turn: 73,
      result: koOdds ? rolledResult : {
        ...rolledResult,
        perSide: { ...rolledResult.perSide, p1: rolledResult.perSide.p1.map(entry => ({ ...entry, koOdds: undefined })) },
      },
      played: {
        p1: { kind: 'move', name: 'Fire Fang', tera: false },
        p2: { kind: 'move', name: 'Body Press', tera: false },
      },
      playedOutcome: -0.1,
      scoreBefore: 0.1,
      scoreAfter: -0.3,
      sacks: { p1: sack },
    });
    const rolled = run({ name: 'Garchomp', hpFraction: 0.11, rolled: 'miss' });
    expect(rolled.p1.sacrifice).toBeUndefined();
    expect(rolled.p1.tier).toBe('mistake');
    // Without the roll the low-HP feed reads as before: demoted, framed as a sack.
    const fed = run({ name: 'Garchomp', hpFraction: 0.11 });
    expect(fed.p1.sacrifice).toEqual({ name: 'Garchomp', hpFraction: 0.11 });
    expect(fed.p1.tier).toBe('inaccuracy');
    // A rolled death whose move carried no knock-out chance stays a feed (conservative).
    const noOdds = run({ name: 'Garchomp', hpFraction: 0.11, rolled: 'miss' }, false);
    expect(noOdds.p1.sacrifice).toBeTruthy();
  });
});
