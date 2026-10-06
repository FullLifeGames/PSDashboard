import { test, expect, describe } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { detectSacks } from '../src/played';
import { sackClause } from '../src/prose/clauses';
import type { SideAnalysis } from '../src/analysis';

/**
 * Round 64 (T123 point 10): detection keeps the side's first sack-shaped
 * faint and skipped every later faint of the side, so a turn that cost two
 * bodies read as one (corpus: 2663093831 t11, 2630685175 t4, 912045 t1,
 * 653785 t26). The verdict still reads the first faint (P2: no faint of the
 * four would earn a different one); the sentence now names the others.
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

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

describe('point 10: a sack names the other bodies the side lost on the turn', () => {
  test('doubles (912045 t1 shape): Ogerpon fed at 9%, Rillaboom fell to the same spread move', () => {
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
    expect(detectSacks(events, before).p2).toEqual({ name: 'Ogerpon', species: 'Ogerpon-Cornerstone', hpFraction: 0.09, alsoFell: ['Rillaboom'] });
  });

  test('singles (653785 t26 shape): the replacement the hazards took after the fed body is named', () => {
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
    expect(detectSacks(events, before).p1).toEqual({ name: 'Tornadus', species: 'Tornadus-Therian', hpFraction: 0.1, alsoFell: ['Volcanion'] });
  });

  test('the sack sentence names them; a one-body sack (573756 t68) says nothing more', () => {
    expect(sackClause('Alpha', side({ sacrifice: { name: 'Ogerpon', hpFraction: 0.09, alsoFell: ['Rillaboom'] } })))
      .toContain('a low-cost trade, not graded as a misplay. Alpha also lost Rillaboom on this turn.');
    const single = sackClause('Alpha', side({ sacrifice: { name: 'T-34-85', hpFraction: 0.77, stayed: true, verified: true } }));
    expect(single).not.toContain('also lost');
    expect(single).toContain('verified as a win-condition sacrifice');
  });
});
