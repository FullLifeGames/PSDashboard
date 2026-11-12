import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { secondaryEffectId } from '../src/dice/recognize';
import { STATUS_NOUNS, effectNoun } from '../src/prose/effect-words';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 89 (#59), stage 5: the effect words of the strand sentence read the Dex. The one table of ours (the six status nouns, since
 * the Dex names a status by its short id) is held to the Dex's status conditions; every secondary of every move in every generation
 * and mod the corpus plays gets a noun that is not the bare id of a stat change or a status.
 */
await loadSimMods('gen9championsou');

const DEXES: [string, ReturnType<typeof rulesDex>][] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => [`gen ${gen}`, rulesDex(gen)] as [string, ReturnType<typeof rulesDex>]),
  ['champions', rulesDex(9, 'champions')],
];

describe('the effect words of the strand sentence', () => {
  test('the status nouns cover exactly the six status conditions of the Dex that moves cause', () => {
    const statuses = Object.entries(Dex.data.Conditions as Record<string, { effectType?: string }>)
      .filter(([, entry]) => entry.effectType === 'Status').map(([id]) => id).filter(id => id !== 'fnt');
    expect(Object.keys(STATUS_NOUNS).sort()).toEqual([...statuses].sort());
  });

  for (const [label, dex] of DEXES) {
    test(`${label}: every secondary of every move has a noun, and a status or a stat change never reads as its id`, () => {
      const seen = new Set<string>();
      for (const move of dex.moves.all()) {
        for (const entry of move.secondaries ?? (move.secondary ? [move.secondary] : [])) {
          const id = secondaryEffectId(entry);
          if (seen.has(id)) continue;
          seen.add(id);
          const noun = effectNoun(dex, id);
          expect(noun, `${move.name}: ${id}`).not.toBe('');
          if (entry.status) expect(noun).toBe(STATUS_NOUNS[entry.status]);
          if (id.startsWith('boosts:')) expect(noun).toMatch(/change$/);
          if (id.startsWith('self:')) expect(noun.startsWith('own ')).toBe(true);
        }
      }
      expect(seen.size).toBeGreaterThan(5);
    });
  }
});
