import { describe, expect, test } from 'vitest';
import { rulesDex } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { DIE_KINDS } from '../src/dice/types';

await loadSimMods('gen9championsou');

const dexes = [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Gen ${gen}`, dex: rulesDex(gen) })), { name: 'Champions', dex: rulesDex(0) }];
const idOf = (kind: string): string => kind.replace(/[^a-z0-9]/g, '');

describe('the kinds of dice', () => {
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
});
