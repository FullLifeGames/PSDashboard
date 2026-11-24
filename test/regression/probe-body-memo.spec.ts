import { describe, expect, test, vi } from 'vitest';

const built = vi.hoisted(() => ({ count: 0 }));
vi.mock('@pkmn/sim', async importOriginal => {
  const actual = await importOriginal<typeof import('@pkmn/sim')>();
  class CountingBattle extends actual.Battle {
    constructor(options: ConstructorParameters<typeof actual.Battle>[0]) {
      built.count++;
      super(options);
    }
  }
  return { ...actual, Battle: CountingBattle };
});

const { loadSimMods, sightedHpAt, snapshotMoveTypes } = await import('@fulllifegames/eval-engine');

// Before the Champions mod registers, its format id plays on the base rules (percent rounds up, the mod down):
// a missing mod answers null and builds nothing.
const SIGHTING = { hp: 50, maxhp: 100 };
const FLAMETHROWER = {
  gen: 9, champions: true, body: { species: 'Charizard' }, abilities: ['blaze'], field: { weather: '', terrain: '' }, clickTera: null, moves: ['Flamethrower'],
};

describe('the probe body of the HP display', () => {
  test('Champions before the mod loads: no battle, null every time, and no base-rules body kept for later', async () => {
    built.count = 0;
    expect(sightedHpAt(9, true, SIGHTING, 300)).toBeNull();
    expect(sightedHpAt(9, true, SIGHTING, 250)).toBeNull();
    expect(snapshotMoveTypes(FLAMETHROWER)).toBeNull();
    expect(built.count).toBe(0);

    await loadSimMods('gen9championsou');
    built.count = 0;
    // The mod rounds the percent down: HP 151 shows 50% of 300, where the base rules' probe read 149.
    expect(sightedHpAt(9, true, SIGHTING, 300)).toBe(151);
    expect(built.count).toBe(1);
    expect(sightedHpAt(9, true, SIGHTING, 250)).not.toBeNull();
    expect(built.count).toBe(1);

    expect(snapshotMoveTypes(FLAMETHROWER)?.get('Flamethrower')).toEqual({ type: 'Fire' });
    expect(built.count).toBe(2);
    expect(snapshotMoveTypes(FLAMETHROWER)?.get('Flamethrower')).toEqual({ type: 'Fire' });
    expect(built.count).toBe(2);
  }, 60_000);

  test('a base generation builds its probe once and keeps it', () => {
    built.count = 0;
    expect(sightedHpAt(9, false, SIGHTING, 300)).toBe(149);
    expect(sightedHpAt(9, false, SIGHTING, 250)).not.toBeNull();
    expect(built.count).toBe(1);
  });
});
