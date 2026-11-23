import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { abilityStateAtHit, abilityStateIds, allyStateIds } from '../src/spreads/ability-state';

// Every ability whose damage handler reads how long the target has been out (activeTurns) or whether a Pokémon still has to move (willMove)
// is in the table of spreads/ability-state.ts, and every table id is such an ability; a new Dex ability of that kind fails here.

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const dexes = [5, 6, 7, 8, 9].map(gen => [`gen ${gen}`, Dex.forGen(gen)] as const).concat([['champions', Dex.mod('champions')] as never]);

const DAMAGE_HANDLER = /^on(Ally|Any|Foe|Source)?(Modify(Atk|SpA|Def|SpD|Damage)|BasePower)$/;
const READS_THE_TURN = /activeTurns|willMove/;

function readers(dex: ReturnType<typeof Dex.forGen>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const ability of dex.abilities.all()) {
    const handlers = Object.entries(ability as unknown as Record<string, unknown>)
      .filter(([key, value]) => DAMAGE_HANDLER.test(key) && typeof value === 'function' && READS_THE_TURN.test(String(value))).map(([key]) => key);
    if (handlers.length > 0) found.set(ability.id, handlers);
  }
  return found;
}

describe('the ability-state table is the Dex\'s abilities that read the turn', () => {
  test.each(dexes)('%s: the same ids', (_name, dex) => {
    expect([...readers(dex).keys()].sort()).toEqual([...abilityStateIds()].sort());
  });

  test('each id reads one of the two facts, and the facts decide', () => {
    for (const id of abilityStateIds()) {
      expect(Dex.abilities.get(id).exists, id).toBe(true);
      expect(abilityStateAtHit(id, {}), `${id} without the fact`).toEqual(id === 'analytic' ? { drop: true } : {});
      expect(abilityStateAtHit(id, { defenderNewlyIn: true, lastToMove: true }), `${id} with the fact`).toEqual({ on: true });
    }
    expect(abilityStateAtHit('intimidate', { defenderNewlyIn: true, lastToMove: true })).toEqual({});
  });
});

function allyReaders(dex: ReturnType<typeof Dex.forGen>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const ability of dex.abilities.all()) {
    for (const [key, value] of Object.entries(ability as unknown as Record<string, unknown>)) {
      if (!DAMAGE_HANDLER.test(key) || typeof value !== 'function' || !/\.allies\(\)/.test(String(value))) continue;
      const named = /hasAbility\(\[([^\]]*)\]\)/.exec(String(value))?.[1].match(/'([^']+)'/g)?.map(name => name.replace(/'/g, '')) ?? [];
      found.set(ability.id, named.sort());
    }
  }
  return found;
}

describe('the ally table is the abilities of the Dex that ask the allies (Plus and Minus)', () => {
  test.each(dexes)('%s: the same ids, each with the abilities its handler names', (_name, dex) => {
    const found = allyReaders(dex);
    expect([...found.keys()].sort()).toEqual([...allyStateIds()].sort());
    for (const [id, named] of found) {
      expect(named.length, id).toBeGreaterThan(0);
      for (const ally of named) expect(abilityStateAtHit(id, { allyAbility: ally }), `${id} beside ${ally}`).toEqual({ on: true });
      expect(abilityStateAtHit(id, { allyAbility: 'intimidate' }), `${id} beside another ability`).toEqual({});
      expect(abilityStateAtHit(id, {}), `${id} alone`).toEqual({});
    }
  });
});
