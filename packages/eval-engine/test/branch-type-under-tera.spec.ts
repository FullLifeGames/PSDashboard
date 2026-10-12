import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { serializeBattleStable } from '../src/forward-model';
import type { BranchMoveOption } from '../src/branch/types';
import { set, singles } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 69 (T182): a move button also carries the type the move lands with
 * after the Tera click (typeUnderTera), read from the simulator on a copy of
 * the battle where the simulator's own terastallize ran. The oracle here is
 * the real queue: the same position played through the click, then read with
 * the same reading as `type`. Singles and doubles share the code (VGC is a
 * doubles format).
 */
const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

const movesOf = (battle: Battle, side: 'p1' | 'p2' = 'p1', slot = 0): BranchMoveOption[] =>
  createBranchStateFromBattle(battle, [], {})[`${side}MovesBySlot`][slot];

const byName = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move]));

/** What the button should show with the toggle pressed: the label the state computed before the click. */
const underTera = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move.typeUnderTera ?? move.type]));
/** What the simulator's queue gives after the click: the state's plain reading on the terastallized body. */
const afterClick = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move.type]));

/** Slot `slot` of p1 clicks Tera on its first move (a Splash); everyone else Splashes. */
function clickTeraAt(battle: Battle, slot: number, doubles: boolean) {
  const own = doubles ? [0, 1].map(index => (index === slot ? 'move 1 terastallize' : 'move 1')).join(', ') : 'move 1 terastallize';
  battle.choose('p1', own);
  battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
}

const ogerpon = (teraType: string) =>
  set('Ogerpon-Wellspring', ['splash', 'ivycudgel', 'terablast'], { item: 'Wellspring Mask', teraType });
const terapagos = () => set('Terapagos', ['splash', 'terastarstorm', 'terablast'], { ability: 'Tera Shift', teraType: 'Stellar' });
const garchomp = () => set('Garchomp', ['splash', 'terablast', 'earthquake'], { teraType: 'Fairy' });

describe('typeUnderTera labels a move with the type after the Tera click (T182)', () => {
  test('singles: Ogerpon-Wellspring follows the simulator\'s queue for Ivy Cudgel and Tera Blast', () => {
    const lead = [ogerpon('Water')];
    const before = movesOf(singles(SINGLES, lead, [splash('Snorlax')]));
    const played = singles(SINGLES, lead, [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    const oracle = afterClick(movesOf(played));
    expect(underTera(before)).toEqual(oracle);
    // The click changes Tera Blast (Normal to Water) and leaves the mask's Ivy Cudgel alone.
    expect(byName(before)['Tera Blast'].type).toBe('Normal');
    expect(byName(before)['Tera Blast'].typeUnderTera).toBe(oracle['Tera Blast']);
    expect(byName(before)['Ivy Cudgel'].typeUnderTera).toBeUndefined();
  });

  test('singles: a Tera type the simulator refuses for Ogerpon changes nothing', () => {
    const before = movesOf(singles(SINGLES, [ogerpon('Fairy')], [splash('Snorlax')]));
    const played = singles(SINGLES, [ogerpon('Fairy')], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    expect(underTera(before)).toEqual(afterClick(movesOf(played)));
    expect(before.every(move => move.typeUnderTera === undefined)).toBe(true);
  });

  test('singles: Terapagos-Terastal reads Stellar for Tera Starstorm, as the queue does', () => {
    const before = movesOf(singles(SINGLES, [terapagos()], [splash('Snorlax')]));
    const played = singles(SINGLES, [terapagos()], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    const oracle = afterClick(movesOf(played));
    expect(oracle['Tera Starstorm']).toBe('Stellar');
    expect(underTera(before)).toEqual(oracle);
    expect(byName(before)['Tera Starstorm'].typeUnderTera).toBe('Stellar');
  });

  test('singles: a plain Tera Blast user reads its Tera type; a move without a type hook carries nothing', () => {
    const before = movesOf(singles(SINGLES, [garchomp()], [splash('Snorlax')]));
    const played = singles(SINGLES, [garchomp()], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    expect(underTera(before)).toEqual(afterClick(movesOf(played)));
    expect(byName(before)['Tera Blast'].typeUnderTera).toBe('Fairy');
    expect(byName(before).Earthquake.typeUnderTera).toBeUndefined();
    expect(byName(before).Splash.typeUnderTera).toBeUndefined();
  });

  test('singles: a body that cannot terastallize, and one that already did, carry no typeUnderTera', () => {
    // Generation 8 has no Terastallization.
    const gen8 = movesOf(singles('gen8customgame', [set('Sylveon', ['hypervoice', 'splash'], { ability: 'Pixilate' })], [splash('Snorlax')]));
    // Pixilate turns every Normal move Fairy, Splash included.
    expect(gen8.map(move => move.type)).toEqual(['Fairy', 'Fairy']);
    expect(gen8.every(move => move.typeUnderTera === undefined)).toBe(true);
    const played = singles(SINGLES, [garchomp()], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    expect(byName(movesOf(played))['Tera Blast'].type).toBe('Fairy');
    expect(movesOf(played).every(move => move.typeUnderTera === undefined)).toBe(true);
  });

  test('doubles: each slot carries its own body\'s label, whichever slot clicks', () => {
    const team = [ogerpon('Water'), garchomp()];
    const foes = [splash('Snorlax'), splash('Blissey')];
    const before = battleOf(DOUBLES, team, foes);
    for (const slot of [0, 1]) {
      const played = battleOf(DOUBLES, team, foes);
      clickTeraAt(played, slot, true);
      expect(underTera(movesOf(before, 'p1', slot))).toEqual(afterClick(movesOf(played, 'p1', slot)));
    }
    expect(byName(movesOf(before, 'p1', 0))['Tera Blast'].typeUnderTera).toBe('Water');
    expect(byName(movesOf(before, 'p1', 1))['Tera Blast'].typeUnderTera).toBe('Fairy');
    expect(byName(movesOf(before, 'p2', 0))).not.toHaveProperty('Tera Blast');
  });

  test('doubles: the Terapagos slot reads Stellar', () => {
    const team = [garchomp(), terapagos()];
    const foes = [splash('Snorlax'), splash('Blissey')];
    const before = battleOf(DOUBLES, team, foes);
    const played = battleOf(DOUBLES, team, foes);
    clickTeraAt(played, 1, true);
    expect(underTera(movesOf(before, 'p1', 1))).toEqual(afterClick(movesOf(played, 'p1', 1)));
    expect(byName(movesOf(before, 'p1', 1))['Tera Starstorm'].typeUnderTera).toBe('Stellar');
  });

  test('guard: reading the state never touches the live battle, and the plain type fields stay as before', () => {
    for (const [format, build] of [
      [SINGLES, () => singles(SINGLES, [ogerpon('Water')], [splash('Snorlax')])],
      [DOUBLES, () => battleOf(DOUBLES, [ogerpon('Water'), terapagos()], [splash('Snorlax'), splash('Blissey')])],
    ] as const) {
      const battle = build();
      const before = serializeBattleStable(battle);
      const logLength = battle.log.length;
      const state = createBranchStateFromBattle(battle, [], {});
      expect(serializeBattleStable(battle), format).toEqual(before);
      expect(battle.log.length).toBe(logLength);
      for (const mon of battle.sides[0].active) {
        expect(mon.terastallized).toBeFalsy();
        expect(mon.canTerastallize).toBeTruthy();
      }
      // The same state with the label stripped is the state the T85 reading builds.
      const stripped = JSON.parse(JSON.stringify(state, (key, value) => (key === 'typeUnderTera' ? undefined : value)));
      expect(stripped.p1MovesBySlot.flat().map((move: BranchMoveOption) => move.type)).toEqual(
        state.p1MovesBySlot.flat().map(move => move.type));
    }
  });
});
