import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { detectRolls } from '../src/dice-events';
import { analyzeTurn, type SideAnalysis } from '../src/analysis';
import { chanceRolled, rolledSides } from '../src/turn-analysis/luck';
import type { EvalResult, KoOddsInfo, RankedChoice } from '../src/types';

/**
 * Round 67 (T22 stage a): the luck ledger splits into what the turn rolled
 * and what the engine re-read. Detection reads the turn's protocol: each
 * dice marker favors the side opposing the body the dice went against, and
 * every hit of a move on an opposing body is kept with its target and
 * whether it took the body's last HP, so a played line's KO odds can be
 * checked against what happened.
 */

const mon = (name: string, speciesForme: string, isActive: boolean) => ({
  name, speciesForme, hp: 100, maxhp: 100, hpPercent: 100,
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

const singles = snapshot(
  [mon('Keldeo', 'Keldeo', true), mon('Tyranitar', 'Tyranitar', false)],
  [mon('Medicham', 'Medicham-Mega', true), mon('Rotom', 'Rotom-Wash', false)],
);

describe('T22 detection: the sides the protocol dice favored', () => {
  test('singles: a crit favors the attacker, a miss and a dice cant favor the other side', () => {
    expect(detectRolls(['|move|p1a: Keldeo|Scald|p2a: Medicham', '|-crit|p2a: Medicham', '|-damage|p2a: Medicham|40/100'], singles).favored)
      .toEqual({ p1: true, p2: false });
    expect(detectRolls(['|move|p1a: Keldeo|Hydro Pump|p2a: Medicham|[miss]', '|-miss|p1a: Keldeo|p2a: Medicham'], singles).favored)
      .toEqual({ p1: false, p2: true });
    expect(detectRolls(['|cant|p2a: Medicham|par'], singles).favored).toEqual({ p1: true, p2: false });
  });

  test('singles: a rolled status favors the other side; a named non-ability source is no roll', () => {
    expect(detectRolls(['|-status|p1a: Keldeo|brn|[from] ability: Flame Body|[of] p2a: Rotom'], singles).favored)
      .toEqual({ p1: false, p2: true });
    expect(detectRolls(['|-status|p1a: Keldeo|slp|[from] move: Rest'], singles).favored).toEqual({ p1: false, p2: false });
    expect(detectRolls(['|-status|p2a: Medicham|tox|[from] item: Toxic Orb'], singles).favored).toEqual({ p1: false, p2: false });
  });

  test('doubles: the second slot\'s markers count by their side as well', () => {
    const before = snapshot(
      [mon('Chi-Yu', 'Chi-Yu', true), mon('Landorus', 'Landorus-Therian', true)],
      [mon('Incineroar', 'Incineroar', true), mon('Dragonite', 'Dragonite', true)],
    );
    expect(detectRolls(['|cant|p2b: Dragonite|flinch'], before).favored).toEqual({ p1: true, p2: false });
    expect(detectRolls(['|-crit|p1b: Landorus'], before).favored).toEqual({ p1: false, p2: true });
  });
});

describe('T22 detection: the hits a move put on an opposing body', () => {
  test('singles: the target comes from the pre-turn snapshot, a hit to 0 HP is a knock-out', () => {
    const rolls = detectRolls([
      '|move|p1a: Keldeo|Hydro Pump|p2a: Medicham',
      '|-damage|p2a: Medicham|0 fnt',
      '|faint|p2a: Medicham',
    ], singles);
    expect(rolls.hits).toMatchObject([{ side: 'p1', move: 'hydropump', target: 'Medicham-Mega', ko: true }]);
  });

  test('singles (649664 t12 shape): a switch-in the move hit is named by its switch line', () => {
    const rolls = detectRolls([
      '|switch|p1a: Tyranitar|Tyranitar, F|168/404',
      '|-damage|p1a: Tyranitar|118/404|[from] Stealth Rock',
      '|move|p2a: Medicham|High Jump Kick|p1a: Tyranitar',
      '|-supereffective|p1a: Tyranitar',
      '|-damage|p1a: Tyranitar|0 fnt',
      '|faint|p1a: Tyranitar',
    ], singles);
    expect(rolls.hits).toMatchObject([{ side: 'p2', move: 'highjumpkick', target: 'Tyranitar', ko: true }]);
    expect(rolls.favored).toEqual({ p1: false, p2: false });
  });

  test('a body that survives the hit and falls to poison after the turn was not knocked out by the hit', () => {
    const rolls = detectRolls([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|3/100',
      '|',
      '|-damage|p2a: Medicham|0 fnt|[from] psn',
      '|faint|p2a: Medicham',
      '|upkeep',
    ], singles);
    expect(rolls.hits).toMatchObject([{ side: 'p1', move: 'scald', target: 'Medicham-Mega', ko: false }]);
  });

  test('doubles: a spread move gives one hit per opposing body, allies stay out', () => {
    const before = snapshot(
      [mon('Chi-Yu', 'Chi-Yu', true), mon('Landorus', 'Landorus-Therian', true)],
      [mon('Incineroar', 'Incineroar', true), mon('Chien-Pao', 'Chien-Pao', true)],
    );
    const rolls = detectRolls([
      '|move|p1a: Chi-Yu|Heat Wave|p2a: Incineroar|[spread] p2a,p2b',
      '|-resisted|p2a: Incineroar',
      '|-damage|p2a: Incineroar|81/100',
      '|-damage|p2b: Chien-Pao|0 fnt',
      '|faint|p2b: Chien-Pao',
      '|move|p1b: Landorus|Earthquake|p2a: Incineroar|[spread] p1a,p2a',
      '|-damage|p1a: Chi-Yu|40/100',
      '|-damage|p2a: Incineroar|30/100',
    ], before);
    expect(rolls.hits).toMatchObject([
      { side: 'p1', move: 'heatwave', target: 'Incineroar', ko: false },
      { side: 'p1', move: 'heatwave', target: 'Chien-Pao', ko: true },
      { side: 'p1', move: 'earthquake', target: 'Incineroar', ko: false },
    ]);
  });

  test('a protected or missed target gives no hit', () => {
    const rolls = detectRolls([
      '|move|p2a: Medicham|High Jump Kick|p1a: Keldeo',
      '|-activate|p1a: Keldeo|move: Protect',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Medicham|[miss]',
      '|-miss|p1a: Keldeo|p2a: Medicham',
    ], singles);
    expect(rolls.hits).toMatchObject([]);
  });
});

const ranked = (choice: string, label: string, ev: number, koOdds?: KoOddsInfo): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null, ...(koOdds ? { koOdds } : {}) });

const playing = (played: RankedChoice | null): SideAnalysis =>
  ({ playedRaw: null, played, best: played, safe: played, regret: 0 });

const quiet = playing(null);
const actives = { p1: 'Ferrothorn', p2: 'Medicham-Mega', gen: 6 };

describe('T22 classification: the sides a turn rolled for', () => {
  test('singles (649664 t12 shape): the odds priced the pre-turn active, the move hit the switch-in, so no roll', () => {
    const rolls = detectRolls([
      '|switch|p1a: Tyranitar|Tyranitar, F|168/404',
      '|move|p2a: Medicham|High Jump Kick|p1a: Tyranitar',
      '|-damage|p1a: Tyranitar|0 fnt',
      '|faint|p1a: Tyranitar',
    ], singles);
    const hjk = playing(ranked('move highjumpkick', 'High Jump Kick', 0.2, { accuracy: 0.9, killFraction: 1 }));
    const rolled = rolledSides(rolls, playing(ranked('switch 3', '→ Tyranitar', -0.2)), hjk, actives);
    expect(rolled).toEqual({ p1: false, p2: false });
    expect(chanceRolled({ chanceDelta: 0.241, rolledFor: rolled })).toBe(false);
  });

  test('singles (649664 t22 and t23 shapes): a knock-out the odds priced is a roll for the attacker, a 90% hit included', () => {
    const lines = (attacker: string, move: string, target: string) =>
      [`|move|${attacker}|${move}|${target}`, `|-damage|${target}|0 fnt`, `|faint|${target}`];
    const pump = playing(ranked('move hydropump', 'Hydro Pump', 0.4, { accuracy: 0.8, killFraction: 1 }));
    expect(rolledSides(detectRolls(lines('p1a: Keldeo', 'Hydro Pump', 'p2a: Medicham'), singles), pump, quiet, { p1: 'Keldeo', p2: 'Medicham-Mega', gen: 6 }))
      .toEqual({ p1: true, p2: false });
    const before = snapshot([mon('Excadrill', 'Excadrill', true)], [mon('Medicham', 'Medicham-Mega', true)]);
    const hjk = playing(ranked('move highjumpkick mega', 'Mega + High Jump Kick', 0.6, { accuracy: 0.9, killFraction: 1 }));
    expect(rolledSides(detectRolls(lines('p2a: Medicham', 'High Jump Kick', 'p1a: Excadrill'), before), quiet, hjk, { p1: 'Excadrill', p2: 'Medicham', gen: 6 }))
      .toEqual({ p1: false, p2: true });
  });

  test('singles (573756 t70 shape): a 3% kill range that does not kill is no roll, a 40% one is a roll for the target', () => {
    const before = snapshot([mon('Clefable', 'Clefable', true)], [mon('Garchomp', 'Garchomp', true)]);
    const rolls = detectRolls(['|move|p1a: Clefable|Moonblast|p2a: Garchomp', '|-damage|p2a: Garchomp|12/100'], before);
    const moonblast = (killFraction: number) => playing(ranked('move moonblast', 'Moonblast', 0.1, { accuracy: 1, killFraction }));
    const where = { p1: 'Clefable', p2: 'Garchomp', gen: 8 };
    expect(rolledSides(rolls, moonblast(0.029), quiet, where)).toEqual({ p1: false, p2: false });
    expect(rolledSides(rolls, moonblast(0.4), quiet, where)).toEqual({ p1: false, p2: true });
  });

  test('doubles (2663093831 t12 shape): the labeled slot\'s 76% knock-out failed, a roll for the target\'s side', () => {
    const before = snapshot(
      [mon('Landorus', 'Landorus-Therian', true), mon('Ting-Lu', 'Ting-Lu', true)],
      [mon('Volcanion', 'Volcanion', true), mon('Chien-Pao', 'Chien-Pao', true)],
    );
    const rolls = detectRolls([
      '|move|p1a: Landorus|Earthquake|p2a: Volcanion|[spread] p2a,p2b',
      '|-damage|p2a: Volcanion|9/100',
      '|-damage|p2b: Chien-Pao|0 fnt',
      '|faint|p2b: Chien-Pao',
    ], before);
    const quake = playing(ranked('move earthquake, move protect', 'Earthquake + Protect', 0.1, { accuracy: 1, killFraction: 0.76, label: 'Earthquake→Volcanion' }));
    expect(rolledSides(rolls, quake, quiet, null)).toEqual({ p1: false, p2: true });
  });

  test('doubles (2663093831 t2 shape): a near-zero kill share is no roll, and the partner slot without odds adds none', () => {
    const before = snapshot(
      [mon('Gholdengo', 'Gholdengo', true), mon('Garchomp', 'Garchomp', true)],
      [mon('Landorus', 'Landorus-Therian', true), mon('Sinistcha', 'Sinistcha', true)],
    );
    const rolls = detectRolls([
      '|move|p1a: Gholdengo|Make It Rain|p2a: Landorus|[spread] p2a,p2b',
      '|-damage|p2a: Landorus|60/100',
      '|-damage|p2b: Sinistcha|70/100',
      '|move|p1b: Garchomp|Rock Slide|p2b: Sinistcha|[spread] p2a,p2b',
      '|-damage|p2a: Landorus|40/100',
      '|-damage|p2b: Sinistcha|52/100',
    ], before);
    const pair = playing(ranked('move makeitrain, move rockslide', 'Make It Rain + Rock Slide', 0.2, { accuracy: 1, killFraction: 0.02, label: 'Make It Rain→Landorus-Therian' }));
    expect(rolledSides(rolls, pair, quiet, null)).toEqual({ p1: false, p2: false });
  });

  test('analyzeTurn carries rolledFor only when it gets the turn\'s rolls; without them the residual stays unclassified', () => {
    const result: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: { p1: [ranked('move hydropump', 'Hydro Pump', 0.3, { accuracy: 0.8, killFraction: 1 })], p2: [ranked('move bulkup', 'Bulk Up', -0.3)] },
    };
    const params = {
      turn: 23, result, playedOutcome: 0.3, scoreBefore: 0.1, scoreAfter: 0.6,
      played: { p1: { kind: 'move' as const, name: 'Hydro Pump' }, p2: { kind: 'move' as const, name: 'Bulk Up' } },
      actives: { p1: 'Keldeo', p2: 'Medicham-Mega', gen: 6 },
    };
    const rolls = detectRolls(['|move|p1a: Keldeo|Hydro Pump|p2a: Medicham', '|-damage|p2a: Medicham|0 fnt', '|faint|p2a: Medicham'], singles);
    const withRolls = analyzeTurn({ ...params, rolls });
    expect(withRolls.rolledFor).toEqual({ p1: true, p2: false });
    expect(chanceRolled(withRolls)).toBe(true);
    const without = analyzeTurn(params);
    expect('rolledFor' in without).toBe(false);
    expect(chanceRolled(without)).toBeNull();
  });
});
