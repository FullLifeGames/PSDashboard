import { describe, expect, test, vi } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { bodyStateKey, readsFactory, type Consumer } from '../src/score/board-key';
import { hitKeyReader, Interner, residualKey } from '../src/score/memo-keys';
import { methodsOf, readsOfEntries } from '../src/dex-facts/state-readers';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEP_CASES } from './dice-sweep-support';
import { attackerOf, boardFor, defenderOf } from './board-key-support';

/**
 * Round 89 (#149, step A8-7): what the board key costs. The hit memo and the end-of-turn memo key every evaluation of a leaf, and the
 * key of a board that stands as another board did is the same text. A key must not pay for a board's composition more than once per
 * process (the reads of the handlers on it are found once and shared by every board of that composition), must not scan a Dex entry
 * for a reader that never asks for a key, and must not touch a field the key leaves out. The partition of the states stays the one
 * of the sweeps (board-key-effects, -census, -readers, -noise, -predicate, contact-memo-state); this file holds the cost rules.
 */

await loadSimMods('gen9championscustomgame');

const CONSUMERS: Consumer[] = ['hit', 'residual'];

/** What the reads of a board were before they were shared: the scan of every entry on the board, the move and the bodies off the field, by the Dex. */
function readsByEntries(battle: Battle, consumer: Consumer, moveId: string | undefined, outside: readonly Pokemon[]): ReadonlySet<string> {
  const { dex, field } = battle;
  const bodyEntries = (pokemon: Pokemon): object[] => [dex.abilities.getByID(pokemon.ability), dex.items.getByID(pokemon.item), dex.conditions.get(pokemon.status), ...Object.keys(pokemon.volatiles).map(id => dex.conditions.get(id))];
  const ids = [field.weather, field.terrain, ...Object.keys(field.pseudoWeather)];
  for (const side of battle.sides) ids.push(...Object.keys(side.sideConditions), ...side.slotConditions.flatMap(slot => Object.keys(slot)));
  const actives = battle.sides.flatMap(side => side.active.filter((pokemon): pokemon is Pokemon => !!pokemon));
  const methods = methodsOf(battle);
  const entries: object[] = [...ids.map(id => dex.conditions.get(id)), ...actives.flatMap(bodyEntries)];
  const union = new Set(readsOfEntries(dex, entries, consumer, methods));
  if (moveId) for (const field of readsOfEntries(dex, [dex.moves.getByID(moveId as never)], consumer, methods)) union.add(field);
  for (const pokemon of outside) for (const field of readsOfEntries(dex, bodyEntries(pokemon), consumer, methods)) union.add(field);
  return union;
}

describe('the reads of a board are found once per composition', () => {
  for (const { rules, mode, name } of SWEEP_CASES) {
    for (const consumer of CONSUMERS) {
      test(`${name}, ${consumer}: two boards with the same entries share one read set, and it is the scan of the Dex entries`, () => {
        for (const lineup of [{}, { attacker: { ability: 'analytic' }, defender: { item: 'rockyhelmet' } }]) {
          const first = boardFor(rules, mode, 'tackle', lineup);
          const second = boardFor(rules, mode, 'tackle', lineup);
          const one = readsFactory(first, consumer)([attackerOf(first), defenderOf(first)], 'tackle');
          const two = readsFactory(second, consumer)([attackerOf(second), defenderOf(second)], 'tackle');
          expect(two).toBe(one);
          expect([...one].sort()).toEqual([...readsByEntries(first, consumer, 'tackle', [])].sort());
        }
      });

      test(`${name}, ${consumer}: a body off the field, another move and another item give another read set, each the scan of its entries`, () => {
        const battle = boardFor(rules, mode, 'tackle');
        const bench = battle.sides[0].pokemon.find(pokemon => !pokemon.isActive);
        const reader = readsFactory(battle, consumer);
        const cases: [string | undefined, Pokemon[]][] = [[undefined, []], ['tackle', []], ['uturn', []], ['tackle', bench ? [bench] : []]];
        for (const [moveId, outside] of cases) expect([...reader(outside, moveId)].sort()).toEqual([...readsByEntries(battle, consumer, moveId, outside)].sort());
        const held = boardFor(rules, mode, 'tackle', { attacker: { item: 'leppaberry' } });
        const plain = readsFactory(battle, consumer)([], undefined);
        expect([...readsFactory(held, consumer)([], undefined)].sort()).toEqual([...readsByEntries(held, consumer, undefined, [])].sort());
        expect(readsFactory(held, consumer)([], undefined) === plain).toBe(readsByEntries(held, consumer, undefined, []).size === plain.size && [...plain].every(field => readsByEntries(held, consumer, undefined, []).has(field)));
      });
    }
  }
});

describe('a key pays for what it reads', () => {
  test('a reader that never asks for a key reads no Dex entry', () => {
    const battle = boardFor(SWEEP_CASES[0].rules, SWEEP_CASES[0].mode, 'tackle');
    const spies = [vi.spyOn(battle.dex.abilities, 'getByID'), vi.spyOn(battle.dex.items, 'getByID'), vi.spyOn(battle.dex.conditions, 'get')];
    hitKeyReader(battle, new Interner());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  for (const { rules, mode, name } of SWEEP_CASES) {
    test(`${name}: a field the key leaves out is not read (a body's own accessor on a bookkeeping field)`, () => {
      const battle = boardFor(rules, mode, 'tackle');
      let touched = 0;
      for (const body of [attackerOf(battle), defenderOf(battle)]) {
        Object.defineProperty(body, 'pokeball', { get() { touched++; return 'pokeball'; }, configurable: true, enumerable: true });
      }
      for (const consumer of CONSUMERS) {
        const reads = readsFactory(battle, consumer)([attackerOf(battle), defenderOf(battle)], 'tackle');
        bodyStateKey(attackerOf(battle), reads, consumer);
      }
      hitKeyReader(battle, new Interner())(attackerOf(battle), defenderOf(battle), 'tackle');
      residualKey(battle, [attackerOf(battle), defenderOf(battle)], new Interner());
      expect(touched).toBe(0);
    });
  }
});
