import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { rulesDex } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { DIE_KINDS } from '../src/dice/types';

// Round 82 (forced dice): a kind of die is named by what the die decides, never by a Dex entry (AGENTS.md: our code reads
// species, move, ability and item names from the Dex, it does not write them). The words of the kinds collide with no
// move, ability, item, condition or species id of any generation or the Champions mod, and the types file needs no lint
// exception for them.
await loadSimMods('gen9championsou');

const dexes = [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Gen ${gen}`, dex: rulesDex(gen) })), { name: 'Champions', dex: rulesDex(0) }];
const idOf = (kind: string): string => kind.replace(/[^a-z0-9]/g, '');

describe('the kinds of dice', () => {
  test('the list holds the fourteen kinds of the plan', () => {
    expect(new Set(DIE_KINDS).size).toBe(14);
    expect(DIE_KINDS).toEqual(expect.arrayContaining(['stalling', 'power', 'move-first']));
  });

  test.each(dexes)('no kind is an entry of the $name Dex', ({ dex }) => {
    for (const kind of DIE_KINDS) {
      const id = idOf(kind);
      expect(dex.moves.get(id).exists, `${kind} as a move`).toBe(false);
      expect(dex.abilities.get(id).exists, `${kind} as an ability`).toBe(false);
      expect(dex.items.get(id).exists, `${kind} as an item`).toBe(false);
      expect(dex.species.get(id).exists, `${kind} as a species`).toBe(false);
      expect(dex.conditions.get(id).exists, `${kind} as a condition`).toBe(false);
    }
  });

  test('the types file carries no lint exception', () => {
    const text = readFileSync(new URL('../src/dice/types.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/eslint-disable/);
  });
});
