import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { detectSacks } from '../src/played';

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

/**
 * Round 63 (T17): a body switched in during the turn's switch phase that
 * falls to entry hazards before it acts is its own sack shape — the attack
 * aimed at it hits nothing and the next body comes in free (653785 t19).
 */
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
    expect(detectSacks(events, before)).toEqual({
      p1: { name: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true },
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
    expect(detectSacks(events, before).p2).toEqual({ name: 'Amoonguss', hpFraction: 0.4, healthy: true, hazard: true });
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
    expect(detectSacks(events, before).p2?.hazard).toBeUndefined();
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
    expect(detectSacks(events, before).p1?.hazard).toBeUndefined();
  });
});
