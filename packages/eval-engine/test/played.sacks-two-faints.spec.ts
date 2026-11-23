import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { logRules } from '@fulllifegames/replay-core';
import { analyzeTurn } from '../src/analysis';
import { detectSacks, type SackInfo, loggedMoves, parsePlayedActions, parsePlayedActionsDoubles } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * A turn that cost a side two bodies: every own faint is judged, the framing holds only when each fallen body earns it under its own shape's
 * gate, and a plain loss next to a feed blocks it.
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

/** The Uxie sack: regret 0.2 is a mistake, a low-HP feed alone demotes it to an inaccuracy. */
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

describe('hazard-sack', () => {
  const mon = (name: string, speciesForme: string, hpPercent: number, isActive: boolean) => ({
    name, speciesForme, hp: hpPercent, maxhp: 100, hpPercent,
    status: '', fainted: false, isActive, boosts: {}, moves: [],
    ability: '', item: '', terastallized: '', level: 100, gender: '',
  });

  const snapshot = (p1: ReturnType<typeof mon>[], p2: ReturnType<typeof mon>[]): TurnSnapshot => ({
    turn: 19,
    p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: p1 },
    p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: p2 },
    field: { weather: '', terrain: '', pseudoWeather: {} },
    log: [],
  });

  /** A body switched in during the turn's switch phase that falls to entry hazards before it acts is its own sack shape: the attack aimed at it hits nothing (653785 turn 19). */
  describe('the hazard sack', () => {
    test('singles, 653785 t19: Weavile switched into Stealth Rock at 22% is a hazard sack', () => {
      const events = [
        '|switch|p1a: Weavile|Weavile, M|63/281',
        '|-damage|p1a: Weavile|0 fnt|[from] Stealth Rock',
        '|faint|p1a: Weavile',
        '|detailschange|p2a: Charizard|Charizard-Mega-X, M, shiny',
        '|move|p2a: Charizard|Flare Blitz|p1: Weavile|[notarget]',
        '|-fail|p2a: Charizard',
        '|upkeep',
        '|switch|p1a: Lopunny|Lopunny-Mega, F|226/271',
      ];
      const before = snapshot(
        [mon('Tornadus', 'Tornadus-Therian', 60, true), mon('Weavile', 'Weavile', 22, false)],
        [mon('Charizard', 'Charizard', 80, true)],
      );
      expect(detectSacks(events, before, logRules(''))).toEqual({
        p1: { name: 'Weavile', species: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true },
      });
    });

    test('doubles: a slot switched into Spikes that falls before acting is a hazard sack of its side', () => {
      const events = [
        '|switch|p2b: Amoonguss|Amoonguss, F|40/100',
        '|-damage|p2b: Amoonguss|0 fnt|[from] Spikes',
        '|faint|p2b: Amoonguss',
        '|move|p1a: Chi-Yu|Heat Wave|p2a: Rillaboom|[spread] p2a',
      ];
      const before = snapshot(
        [mon('Chi-Yu', 'Chi-Yu', 100, true)],
        [mon('Rillaboom', 'Rillaboom', 100, true), mon('Amoonguss', 'Amoonguss', 40, false)],
      );
      expect(detectSacks(events, before, logRules('')).p2).toEqual({ name: 'Amoonguss', species: 'Amoonguss', hpFraction: 0.4, healthy: true, hazard: true });
    });

    test('a replacement after a move (a pivot or an end-of-turn switch) killed by hazards is no hazard sack', () => {
      const events = [
        '|move|p2a: Landorus|U-turn|p1a: Heatran',
        '|switch|p2a: Weavile|Weavile, M|60/281',
        '|-damage|p2a: Weavile|0 fnt|[from] Stealth Rock',
        '|faint|p2a: Weavile',
      ];
      const before = snapshot(
        [mon('Heatran', 'Heatran', 100, true)],
        [mon('Landorus', 'Landorus-Therian', 100, true), mon('Weavile', 'Weavile', 21, false)],
      );
      expect(detectSacks(events, before, logRules('')).p2?.hazard).toBeUndefined();
    });

    test('a switch-in that falls to a move, not to the hazards, is no hazard sack', () => {
      const events = [
        '|switch|p1a: Weavile|Weavile, M|63/281',
        '|-damage|p1a: Weavile|30/281|[from] Stealth Rock',
        '|move|p2a: Charizard|Flare Blitz|p1a: Weavile',
        '|-damage|p1a: Weavile|0 fnt',
        '|faint|p1a: Weavile',
      ];
      const before = snapshot(
        [mon('Tornadus', 'Tornadus-Therian', 60, true), mon('Weavile', 'Weavile', 22, false)],
        [mon('Charizard', 'Charizard', 80, true)],
      );
      expect(detectSacks(events, before, logRules('')).p1?.hazard).toBeUndefined();
    });
  });
});

const rules = logRules('');

describe('singles: a side that falls before acting', () => {
  const lines = ['|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|-damage|p1a: Grafaiai|0 fnt', '|faint|p1a: Grafaiai', '|upkeep'];

  test('carries the moves before the fall', () => {
    const turn = parsePlayedActions(lines, rules);
    expect(turn.prevented).toEqual({ p1: 'faint' });
    expect(turn.fell).toEqual({
      p1: [{ before: [{ slot: 'p2a', move: 'Psyshock' }], speedMoved: false, activations: [] }],
    });
  });

  test('a side that acted before it fainted carries no mark', () => {
    const turn = parsePlayedActions(['|move|p1a: Grafaiai|Gunk Shot|p2a: Valiant', '|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai'], rules);
    expect(turn.fell).toBeUndefined();
  });

  test('a cant line is no fall', () => {
    expect(parsePlayedActions(['|cant|p1a: Grafaiai|slp', '|move|p2a: Valiant|Psyshock|p1a: Grafaiai'], rules).fell).toBeUndefined();
  });

  test('a move another effect ran is no action, a locked move is', () => {
    const turn = parsePlayedActions([
      '|move|p2a: Valiant|Fiery Dance|p1a: Grafaiai|[from]ability: Dancer',
      '|move|p2a: Valiant|Outrage|p1a: Grafaiai|[from]lockedmove',
      '|faint|p1a: Grafaiai',
    ], rules);
    expect(turn.fell?.p1?.[0]?.before).toEqual([{ slot: 'p2a', move: 'Outrage' }]);
  });

  test('a speed line before the fall marks it, one after does not', () => {
    const early = parsePlayedActions(['|move|p2a: Valiant|Icy Wind|p1a: Grafaiai', '|-unboost|p1a: Grafaiai|spe|1', '|faint|p1a: Grafaiai'], rules);
    const late = parsePlayedActions(['|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai', '|-unboost|p2a: Valiant|spe|1'], rules);
    expect([early.fell?.p1?.[0]?.speedMoved, late.fell?.p1?.[0]?.speedMoved]).toEqual([true, false]);
  });

  test('the whole turn\'s activation lines travel with the mark', () => {
    const activate = '|-activate|p2a: Valiant|item: Quick Claw';
    const turn = parsePlayedActions([activate, '|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai'], rules);
    expect(turn.fell?.p1?.[0]?.activations).toEqual([activate]);
  });
});

describe('doubles: a slot that falls before acting', () => {
  test('marks that slot only and leaves the partner and the foes unmarked', () => {
    const turn = parsePlayedActionsDoubles([
      '|move|p2a: Floette|Dazzling Gleam|p1a: Dragonite|[spread] p1a,p1b',
      '|-damage|p1a: Dragonite|0 fnt',
      '|faint|p1a: Dragonite',
      '|move|p1b: Empoleon|Flash Cannon|p2a: Floette',
    ]);
    expect(turn.p1Slots?.[0]).toBeNull();
    expect(turn.fell).toEqual({
      p1: [{ before: [{ slot: 'p2a', move: 'Dazzling Gleam' }], speedMoved: false, activations: [] }, null],
    });
  });

  test('a mark names the partner\'s move when it ran before the fall, and leaves out the slot\'s own', () => {
    const turn = parsePlayedActionsDoubles([
      '|move|p1b: Empoleon|Flash Cannon|p2a: Floette',
      '|move|p2b: Ally|Surf|p1a: Dragonite',
      '|faint|p1a: Dragonite',
    ]);
    expect(turn.fell?.p1?.[0]?.before).toEqual([{ slot: 'p1b', move: 'Flash Cannon' }, { slot: 'p2b', move: 'Surf' }]);
  });

  test('a slot that acted before it fainted, and a cant line, carry no mark', () => {
    const turn = parsePlayedActionsDoubles([
      '|cant|p2a: Floette|flinch',
      '|move|p1a: Dragonite|Dragon Pulse|p2a: Floette',
      '|faint|p1a: Dragonite',
    ]);
    expect(turn.fell).toBeUndefined();
  });

  test('both sides can fall: each slot gets its own earlier moves', () => {
    const turn = parsePlayedActionsDoubles([
      '|move|p1b: A|Surf|p2a: B',
      '|faint|p2a: B',
      '|move|p2b: C|Surf|p1a: D',
      '|faint|p1a: D',
    ]);
    expect(turn.fell?.p2?.[0]?.before).toEqual([{ slot: 'p1b', move: 'Surf' }]);
    expect(turn.fell?.p1?.[0]?.before).toEqual([{ slot: 'p1b', move: 'Surf' }, { slot: 'p2b', move: 'Surf' }]);
  });
});

describe('the shared extractor', () => {
  test('lists the action moves of a stretch of lines', () => {
    expect(loggedMoves(['|move|p1a: A|Surf|p2a: B', '|move|p2a: B|Copycat|p2a: B|[from]move: Copycat', '|-damage|p2a: B|10/100']))
      .toEqual([{ slot: 'p1a', move: 'Surf' }]);
  });
});
