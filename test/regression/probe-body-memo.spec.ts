import { describe, expect, test, vi } from 'vitest';

// Counts the battles the engine builds, so the spec can tell a probe that is asked again from one that is remembered.
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

/**
 * Round 70 (T215): the quick picker reads the HP a percent stands for off a probe body (sightedHpAt), a one-Pokémon
 * battle of the format. The Champions mod loads on demand; before it registers, the format id is unknown to the
 * simulator and a battle of it comes up on the base rules, without an error. The probe used to take that body for the
 * Champions one and keep it, so a picker built before the mod showed the base rules' HP (the base rounds the percent
 * up, the mod down) for the rest of the session. Now a missing mod answers null without building a battle, and the
 * next build asks again; a body that was built is kept, and so is a generation that has no body. The picker's move
 * types (snapshotMoveTypes) read the same kind of twin and follow the same rule.
 */
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

    // The move types come from a twin of the body, built once and remembered.
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
