import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Side } from '@pkmn/sim';
import { advancePosition, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { submittableChoice } from '../src/forward/request-moves';
import { doublesRoot, pairSet } from './pair-battles';
import { SEEDS } from './sim-fast-helpers';

/**
 * Round 60 (T94): a locked doubles slot (rampage, charge release, recharge,
 * Bide, Uproar) gets a request entry with NO target type (pokemon.js
 * getMoves(lockedMove)). By name the sim then assumes 'normal' and demands a
 * target (side.js:397,469: "Outrage needs a target"); by index it takes the
 * missing type and uses the locked target itself (side.js:384,480-492).
 * smogtours-gen9doublesou-913996 turn 6: p1's Dragonite rages since turn 5,
 * every option of the position was rejected and the bank dropped the row.
 */

const WALLS = [pairSet('Wall', 'Blissey', ['Splash'], { level: 100 }), pairSet('Wall2', 'Chansey', ['Splash'], { level: 100 })];
const QUIET = 'move splash, move splash';

/** The request entries of p1's slot `slot` after the setup turn. */
function slotEntries(position: ReturnType<typeof createRootPosition>, slot: number): Record<string, unknown>[] {
  const request = positionBattle(position).sides[0].activeRequest as { active?: { moves: Record<string, unknown>[] }[] } | null;
  return request?.active?.[slot]?.moves ?? [];
}

describe('locked doubles slots (round 60, T94)', () => {
  test('913996 turn 6: the raging slot offers one bare option and every option plays', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('./fixtures/positions/smogtours-gen9doublesou-913996-t6.json', import.meta.url), 'utf-8')) as { serialized: string };
    const root = createRootPosition(fixture.serialized);
    const p1 = legalChoices(root, 'p1', { tera: true });
    const p2 = legalChoices(root, 'p2', { tera: true }).slice(0, 3);
    expect(p1.length).toBeGreaterThan(0);
    for (const option of p1) expect(option.choice.split(', ')[1]).toBe('move outrage');
    for (const mine of p1) {
      for (const theirs of p2) {
        for (const seed of SEEDS) expect(() => advancePosition(root, mine.choice, theirs.choice, seed)).not.toThrow();
      }
    }
  });

  const CLASSES: { name: string; move: string; turn1: string }[] = [
    { name: 'rampage', move: 'Outrage', turn1: 'move outrage, move splash' },
    { name: 'uproar', move: 'Uproar', turn1: 'move uproar, move splash' },
    { name: 'bide', move: 'Bide', turn1: 'move bide, move splash' },
    { name: 'geomancy', move: 'Geomancy', turn1: 'move geomancy, move splash' },
    { name: 'razor wind', move: 'Razor Wind', turn1: 'move razorwind, move splash' },
    { name: 'recharge', move: 'Prismatic Laser', turn1: 'move prismaticlaser 1, move splash' },
    { name: 'charge release', move: 'Phantom Force', turn1: 'move phantomforce 1, move splash' },
  ];

  for (const kind of CLASSES) {
    test(`${kind.name}: the locked slot is one bare option and its turn plays`, () => {
      const root = doublesRoot(
        [pairSet('Locked', 'Garchomp', [kind.move]), pairSet('Partner', 'Snorlax', ['Splash'])],
        WALLS,
        battle => battle.makeChoices(kind.turn1, QUIET),
      );
      // Not vacuous (the round-60 lesson of eval-search.spec.ts): the slot IS locked.
      const entries = slotEntries(root, 0);
      expect(entries).toHaveLength(1);
      expect('target' in entries[0]).toBe(false);
      const options = legalChoices(root, 'p1', { tera: false });
      const lockedParts = new Set(options.map(option => option.choice.split(', ')[0]));
      expect([...lockedParts]).toEqual([`move ${String(entries[0].id)}`]);
      for (const seed of SEEDS) expect(() => advancePosition(root, options[0].choice, QUIET, seed)).not.toThrow();
    });
  }

  test('both slots locked into the same move: each part goes to its own slot', () => {
    const root = doublesRoot(
      [pairSet('A', 'Garchomp', ['Outrage']), pairSet('B', 'Dragonite', ['Outrage'])],
      WALLS,
      battle => battle.makeChoices('move outrage, move outrage', QUIET),
    );
    expect('target' in slotEntries(root, 0)[0]).toBe(false);
    expect('target' in slotEntries(root, 1)[0]).toBe(false);
    const side = positionBattle(root).sides[0];
    expect(submittableChoice(side, 'move outrage, move outrage')).toBe('move 1, move 1');
    for (const seed of SEEDS) expect(() => advancePosition(root, 'move outrage, move outrage', QUIET, seed)).not.toThrow();
  });

  test('a target number on a locked part is dropped and the sim accepts the choice', () => {
    const root = doublesRoot(
      [pairSet('Ghost', 'Dragapult', ['Phantom Force']), pairSet('Partner', 'Snorlax', ['Splash'])],
      WALLS,
      battle => battle.makeChoices('move phantomforce 1, move splash', QUIET),
    );
    const side = positionBattle(root).sides[0];
    expect(submittableChoice(side, 'move phantomforce 2, move splash')).toBe('move 1, move splash');
    for (const seed of SEEDS) expect(() => advancePosition(root, 'move phantomforce 2, move splash', QUIET, seed)).not.toThrow();
  });

  test('parts skip a fainted slot the way the sim does', () => {
    const side = {
      active: [{ fainted: true, volatiles: {} }, { fainted: false, volatiles: {} }],
      requestState: 'move',
      activeRequest: { active: [
        { moves: [{ move: 'Tackle', id: 'tackle', target: 'normal' }] },
        { moves: [{ move: 'Outrage', id: 'outrage' }] },
      ] },
    } as unknown as Side;
    expect(submittableChoice(side, 'move outrage')).toBe('move 1');
    const alive = { ...side, active: [{ fainted: false, volatiles: {} }, { fainted: false, volatiles: {} }] } as unknown as Side;
    expect(submittableChoice(alive, 'move tackle 1, move outrage')).toBe('move tackle 1, move 1');
  });

  test('choices without a locked part and singles come back unchanged', () => {
    const root = doublesRoot([pairSet('A', 'Garchomp', ['Outrage']), pairSet('B', 'Snorlax', ['Splash'])], WALLS);
    const side = positionBattle(root).sides[0];
    const choice = 'move outrage, move splash';
    expect(submittableChoice(side, choice)).toBe(choice);
    const single = { active: [{ fainted: false, volatiles: {} }], requestState: 'move',
      activeRequest: { active: [{ moves: [{ move: 'Outrage', id: 'outrage' }] }] } } as unknown as Side;
    expect(submittableChoice(single, 'move outrage')).toBe('move outrage');
  });
});
