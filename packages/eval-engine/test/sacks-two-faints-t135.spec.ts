import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { logRules } from '@fulllifegames/replay-core';
import { analyzeTurn } from '../src/analysis';
import { detectSacks, type SackInfo } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 67 (T135 point 1, rule A): a turn that cost a side two bodies was
 * judged by its first sack-shaped faint alone; the others were only named.
 * The sack leniency rests on a deliberate, cheap loss, so every own faint of
 * the turn is judged now: the framing holds only when each fallen body earns
 * it under its own shape's gate, and a plain loss next to a feed blocks it.
 * Corpus (P4, base-1010-1): no faint of the four two-faint side-turns earns a
 * sack, so no corpus verdict moves; bank doubles: 10 of 34 such side-turns
 * carry a stricter gate behind a low-HP feed (P5).
 */

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

describe('T135 point 1: detection keeps the shape of every own faint', () => {
  test('doubles (912045 t1 shape): the fed Ogerpon carries Rillaboom\'s shape next to its name', () => {
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
    expect(detectSacks(events, before, logRules('')).p2?.others).toEqual([{ name: 'Rillaboom', species: 'Rillaboom', hpFraction: 0.78, stayed: true }]);
  });

  test('singles (653785 t26 shape): the replacement the Spikes took after the fed body keeps its healthy shape', () => {
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
    expect(detectSacks(events, before, logRules('')).p1?.others).toEqual([{ name: 'Volcanion', species: 'Volcanion', hpFraction: 109 / 363, healthy: true }]);
  });

  test('a one-body sack carries no others (573756 t68 guard)', () => {
    const events = ['|move|p2a: Corviknight|Body Press|p1a: Garchomp', '|-damage|p1a: Garchomp|0 fnt', '|faint|p1a: Garchomp'];
    const before = snapshot([mon('Garchomp', 'Garchomp', 11, true)], [mon('Corviknight', 'Corviknight', 27, true)]);
    expect(detectSacks(events, before, logRules('')).p1).toEqual({ name: 'Garchomp', species: 'Garchomp', hpFraction: 0.11 });
  });
});

const choiceEv = (choice: string, label: string, worstCase: number, ev: number): RankedChoice =>
  ({ choice, label, worstCase, expected: worstCase, ev, punishedBy: 'Reply' });

/** The Uxie sack of the round-12 tests: regret 0.2 is a mistake, a low-HP feed alone demotes it to an inaccuracy. */
const uxieTurn = (sack: SackInfo) => {
  const result: EvalResult = {
    score: 0.1, interval: 0.05, depthCompleted: 2,
    perSide: {
      p1: [choiceEv('move dracometeor', 'Draco Meteor', 0.2, 0.2), choiceEv('switch 2', '→ Uxie', -0.1, 0.0)],
      p2: [choiceEv('move trick', 'Trick', -0.05, -0.05)],
    },
  };
  return analyzeTurn({
    turn: 29, result,
    played: { p1: { kind: 'switch', name: 'Dauni', species: 'Uxie' }, p2: { kind: 'move', name: 'Trick', tera: false } },
    playedOutcome: -0.1, scoreBefore: 0.1, scoreAfter: -0.1,
    sacks: { p1: sack },
  });
};

describe('T135 point 1, rule A: every fallen body must earn the sack framing', () => {
  test('a low-HP feed next to a plain loss is no sack: the band stays', () => {
    const analysis = uxieTurn({ name: 'Uxie', hpFraction: 0.09, alsoFell: ['Latios'], others: [null] });
    expect(analysis.p1.sacrifice).toBeUndefined();
    expect(analysis.p1.tier).toBe('mistake');
  });

  test('a low-HP feed next to a body left in whose feed gate fails is no sack', () => {
    const analysis = uxieTurn({ name: 'Uxie', hpFraction: 0.09, alsoFell: ['Latios'], others: [{ name: 'Latios', hpFraction: 0.6, stayed: true }] });
    expect(analysis.p1.sacrifice).toBeUndefined();
    expect(analysis.p1.tier).toBe('mistake');
  });

  test('two low-HP feeds keep the framing (doubles shape), and a one-body sack is unchanged', () => {
    const two = uxieTurn({ name: 'Uxie', hpFraction: 0.09, alsoFell: ['Latios'], others: [{ name: 'Latios', hpFraction: 0.1 }] });
    expect(two.p1.sacrifice?.name).toBe('Uxie');
    expect(two.p1.tier).toBe('inaccuracy');
    const one = uxieTurn({ name: 'Uxie', hpFraction: 0.09 });
    expect(one.p1.sacrifice).toEqual({ name: 'Uxie', hpFraction: 0.09 });
    expect(one.p1.tier).toBe('inaccuracy');
  });
});
