import { describe, expect, test } from 'vitest';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { chipOrigin, chipPickText, chipPlaceholder } from '../../../src/lib/dock-chip';
import { moveOption, targetOption } from '../fixtures/sim-state';

/** Round 84 (turn dock): what a slot's chip says about its choice. */
const moves = [
  moveOption('Flare Blitz', { slot: 2, requiresTarget: true, targetOptions: [targetOption('p2', 0, 'Rillaboom', 1), targetOption('p2', 1, 'Tornadus', 2)] }),
  moveOption('Protect', { slot: 4 }),
];
const flare = (extra: Partial<Extract<BranchSlotChoice, { kind: 'move' }>> = {}): BranchSlotChoice =>
  ({ kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', ...extra });

describe('chipPickText', () => {
  test('a move names its target by label, then the gimmick, then the dice', () => {
    expect(chipPickText(flare(), moves)).toBe('Flare Blitz');
    expect(chipPickText(flare({ targetLoc: 2 }), moves)).toBe('Flare Blitz → P2B');
    expect(chipPickText(flare({ targetLoc: 2, modifier: 'terastallize' }), moves)).toBe('Flare Blitz → P2B · Tera');
    expect(chipPickText(flare({ modifier: 'mega' }), moves)).toBe('Flare Blitz · Mega');
    expect(chipPickText(flare({ modifier: 'ultra' }), moves)).toBe('Flare Blitz · Ultra Burst');
    expect(chipPickText(flare({ modifier: 'zmove' }), moves)).toBe('Flare Blitz · Z-Move');
    const dice = [{ name: { kind: 'hit', slot: 'p1a', moveId: 'flareblitz' }, result: { happens: true } }] as never;
    expect(chipPickText(flare({ dice }), moves)).toBe('Flare Blitz · dice');
  });

  test('a switch names the body, a missing choice reads empty', () => {
    expect(chipPickText({ kind: 'switch', speciesId: 'kingambit', pokemonName: 'Kingambit' }, moves)).toBe('→ Kingambit');
    expect(chipPickText(null, moves)).toBe('');
  });

  test('a target the move no longer lists falls back to the location', () => {
    expect(chipPickText(flare({ targetLoc: -1 }), moves)).toBe('Flare Blitz → -1');
  });
});

describe('chipOrigin', () => {
  test('the seed\'s own choice is "played"; any other choice is the user\'s; no choice has no origin', () => {
    const seeded = flare();
    expect(chipOrigin(seeded, seeded)).toBe('played');
    expect(chipOrigin(flare(), seeded)).toBeNull();
    expect(chipOrigin(null, seeded)).toBeNull();
    expect(chipOrigin(seeded, null)).toBeNull();
    expect(chipOrigin(seeded, undefined)).toBeNull();
  });
  test('a choice the engine filled is "engine", also over a seed; no choice has none even if marked', () => {
    expect(chipOrigin(flare(), null, true)).toBe('engine');
    expect(chipOrigin(flare(), undefined, true)).toBe('engine');
    const seeded = flare();
    expect(chipOrigin(seeded, seeded, true)).toBe('engine');
    expect(chipOrigin(null, null, true)).toBeNull();
    expect(chipOrigin(flare(), null, false)).toBeNull();
  });
});

describe('chipPlaceholder', () => {
  const base = { forceSwitch: false, nobodyLeft: false, played: null, hasRecord: true };
  test('a slot without a logged action says so; a played move the picker lacks names it', () => {
    expect(chipPlaceholder(base)).toBe('no logged move · choose');
    expect(chipPlaceholder({ ...base, played: { kind: 'move', name: 'Rock Slide' } })).toBe('played: Rock Slide · choose');
    expect(chipPlaceholder({ ...base, played: { kind: 'switch', name: 'Kingambit' } })).toBe('played: → Kingambit · choose');
  });
  test('without a played record the slot reads "choose"; a forced replacement and an empty bench say their own', () => {
    expect(chipPlaceholder({ ...base, hasRecord: false })).toBe('choose');
    expect(chipPlaceholder({ ...base, forceSwitch: true })).toBe('choose a replacement');
    expect(chipPlaceholder({ ...base, nobodyLeft: true })).toBe('fainted · no one left');
  });
  test('while the engine fills or is blocked by the game analysis, an empty slot says so; a forced replacement and an empty bench keep their text', () => {
    expect(chipPlaceholder({ ...base, hasRecord: false, engine: 'pending' })).toBe('engine choosing…');
    expect(chipPlaceholder({ ...base, hasRecord: false, engine: 'busy' })).toBe('engine busy with the game analysis');
    expect(chipPlaceholder({ ...base, hasRecord: false, engine: null })).toBe('choose');
    expect(chipPlaceholder({ ...base, hasRecord: false, engine: 'pending', forceSwitch: true })).toBe('choose a replacement');
    expect(chipPlaceholder({ ...base, hasRecord: false, engine: 'busy', nobodyLeft: true })).toBe('fainted · no one left');
  });
});

describe("chipPlaceholder, the engine's deferred pick (round 84, A7a)", () => {
  const base = { forceSwitch: false, nobodyLeft: false, played: null, hasRecord: false };
  test('a held slot with a deferred pick reads "engine: <pick> · choose", in the manner of the played pick', () => {
    expect(chipPlaceholder({ ...base, deferred: { kind: 'move', name: 'Rock Slide' } })).toBe('engine: Rock Slide · choose');
    expect(chipPlaceholder({ ...base, deferred: { kind: 'switch', name: 'Kingambit' } })).toBe('engine: → Kingambit · choose');
  });
  test("the deferred pick outranks the played one and a forced replacement's text; an empty bench keeps its own", () => {
    const played = { kind: 'move' as const, name: 'Protect' };
    expect(chipPlaceholder({ ...base, played, hasRecord: true, deferred: { kind: 'move', name: 'Rock Slide' } })).toBe('engine: Rock Slide · choose');
    expect(chipPlaceholder({ ...base, forceSwitch: true, deferred: { kind: 'switch', name: 'Kingambit' } })).toBe('engine: → Kingambit · choose');
    expect(chipPlaceholder({ ...base, nobodyLeft: true, deferred: { kind: 'switch', name: 'Kingambit' } })).toBe('fainted · no one left');
  });
});
