import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { logRules } from '@fulllifegames/replay-core';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import { detectSacks } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 76 (T244): 655336 turn 25, p2 switches Lopunny-Mega at 38/271 into
 * Stealth Rock and Spikes; Charizard's Dragon Claw finds no target and
 * Slowbro comes in free. The bisect (lane R ledger) put the blunder reading
 * of round 70 (regret 0.4156) on 0da5ec7 (T223, a standing stage), and
 * rounds 73's T225 and T248 took it back to 0.0563 with no tier (the
 * feedback dump at a2e7c2b). This spec holds both halves: the sack
 * recognition sees the sack in singles and doubles, and the gate keeps its
 * rule at both sets of numbers (a blunder-sized regret is never excused; a
 * sack the window did not repay earns no stamp).
 */
const mon = (name: string, speciesForme: string, hpPercent: number, isActive: boolean) => ({
  name, speciesForme, hp: hpPercent, maxhp: 100, hpPercent,
  status: '', fainted: false, isActive, boosts: {}, moves: [],
  ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const snapshot = (p1: ReturnType<typeof mon>[], p2: ReturnType<typeof mon>[]): TurnSnapshot => ({
  turn: 25,
  p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: p1 },
  p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: p2 },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
});

describe('655336 t25: the sack recognition', () => {
  test('singles: Lopunny-Mega at 14% into Stealth Rock and Spikes is a low-HP hazard sack', () => {
    const events = [
      '|switch|p2a: Lopunny|Lopunny-Mega, F|38/271',
      '|-damage|p2a: Lopunny|22/271|[from] Stealth Rock',
      '|-damage|p2a: Lopunny|0 fnt|[from] Spikes',
      '|faint|p2a: Lopunny',
      '|move|p1a: Charizard|Dragon Claw|p2: Lopunny|[notarget]',
      '|-fail|p1a: Charizard',
      '|upkeep',
      '|switch|p2a: Slowbro|Slowbro, M|293/393 par',
    ];
    const before = snapshot(
      [mon('Charizard', 'Charizard-Mega-X', 100, true)],
      [mon('Slowbro', 'Slowbro', 75, true), mon('Lopunny', 'Lopunny-Mega', 14, false)],
    );
    expect(detectSacks(events, before, logRules('')).p2).toEqual({
      name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 0.14, hazard: true,
    });
  });

  test('doubles: the same switch into the hazards on slot b is a low-HP hazard sack of its side', () => {
    const events = [
      '|switch|p2b: Lopunny|Lopunny-Mega, F|38/271',
      '|-damage|p2b: Lopunny|22/271|[from] Stealth Rock',
      '|-damage|p2b: Lopunny|0 fnt|[from] Spikes',
      '|faint|p2b: Lopunny',
      '|move|p1a: Charizard|Dragon Claw|p2a: Slowbro',
    ];
    const before = snapshot(
      [mon('Charizard', 'Charizard-Mega-X', 100, true)],
      [mon('Slowbro', 'Slowbro', 75, true), mon('Amoonguss', 'Amoonguss', 90, true), mon('Lopunny', 'Lopunny-Mega', 14, false)],
    );
    expect(detectSacks(events, before, logRules('')).p2).toEqual({
      name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 0.14, hazard: true,
    });
  });
});

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number, punishedBy: string | null): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy });

/** The turn at one set of numbers: Protect is the engine's best, the switch is the played row. */
const t25 = (numbers: { score: number; protect: [number, number, number]; lopunny: [number, number, number] }, overrides: Partial<AnalyzeTurnParams> = {}) => {
  const result: EvalResult = {
    score: numbers.score, interval: 0, depthCompleted: 2,
    perSide: {
      p1: [ranked('move dragonclaw', 'Dragon Claw', 0.64, 0.77, 0.68, 'Protect')],
      p2: [
        ranked('move protect', 'Protect', numbers.protect[0], numbers.protect[1], numbers.protect[2], 'Roost'),
        ranked('switch 4', '→ Lopunny-Mega', numbers.lopunny[0], numbers.lopunny[1], numbers.lopunny[2], 'Roost'),
      ],
    },
  };
  return analyzeTurn({
    turn: 25, result,
    played: { p1: { kind: 'move', name: 'Dragon Claw' }, p2: { kind: 'switch', name: 'Lopunny', species: 'Lopunny-Mega' } },
    playedOutcome: 0.838, futureOutcomes: [0.8, 0.82, 0.8],
    scoreBefore: numbers.score, scoreAfter: 0.699,
    sacks: { p2: { name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 38 / 271, hazard: true } },
    ...overrides,
  });
};

describe('655336 t25: the gate at both sets of numbers', () => {
  /** The feedback dump at a2e7c2b: score 0.6958, Protect -0.6779, the switch -0.7343, regret 0.0563. */
  const head = { score: 0.6958, protect: [-0.7263, -0.6224, -0.6779] as [number, number, number], lopunny: [-0.775, -0.7201, -0.7343] as [number, number, number] };
  /** The round-70 dump (0da5ec7 to 8683fa9): score 0.3337, Protect -0.2773, the switch -0.6929, regret 0.4156. */
  const r70 = { score: 0.3337, protect: [-0.45, -0.3, -0.2773] as [number, number, number], lopunny: [-0.9, -0.7, -0.6929] as [number, number, number] };

  test('at the dump of the a2e7c2b engine the turn has no tier and no blame', () => {
    const analysis = t25(head);
    expect(analysis.p2.regret).toBeCloseTo(0.0563, 3);
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.attribution).not.toBe('p2-decision');
  });

  test('the mirror, p1 on the switch, reads the same (the gate has no side; rows are own-perspective)', () => {
    const mirrored = analyzeTurn({
      turn: 25,
      result: {
        score: -head.score, interval: 0, depthCompleted: 2,
        perSide: {
          p1: [ranked('move protect', 'Protect', head.protect[0], head.protect[1], head.protect[2], 'Roost'),
            ranked('switch 4', '→ Lopunny-Mega', head.lopunny[0], head.lopunny[1], head.lopunny[2], 'Roost')],
          p2: [ranked('move dragonclaw', 'Dragon Claw', 0.64, 0.77, 0.68, 'Protect')],
        },
      },
      played: { p1: { kind: 'switch', name: 'Lopunny', species: 'Lopunny-Mega' }, p2: { kind: 'move', name: 'Dragon Claw' } },
      playedOutcome: -0.838, futureOutcomes: [-0.8, -0.82, -0.8],
      scoreBefore: -head.score, scoreAfter: -0.699,
      sacks: { p1: { name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 38 / 271, hazard: true } },
    });
    expect(mirrored.p1.regret).toBeCloseTo(0.0563, 3);
    expect(mirrored.p1.tier).toBeUndefined();
  });

  test('a luck-free window that repays the regret stamps the sack (the form the dump lacks: the position after the pair read 0.139 better for p2)', () => {
    // The pair's value is what came (own outcome -0.838 against the after score -0.838) and the window reaches over the safe floor by the margin.
    const analysis = t25(head, { scoreAfter: 0.838, futureOutcomes: [0.3, 0.3, 0.3] });
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.sacrifice).toMatchObject({ name: 'Lopunny', hazard: true, verified: true });
  });

  test('the dump as it is earns no stamp: the position after the pair beat the pair by more than the epsilon', () => {
    expect(t25(head).p2.sacrifice).toBeUndefined();
  });

  test('at the round-70 numbers a blunder-sized hazard sack still grades, even with a paying window', () => {
    const analysis = t25(r70, { scoreAfter: 0.838, futureOutcomes: [0.3, 0.3, 0.3] });
    expect(analysis.p2.regret).toBeCloseTo(0.4156, 3);
    expect(analysis.p2.tier).toBe('blunder');
    expect(analysis.p2.sacrifice).toBeUndefined();
  });
});
