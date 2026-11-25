import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { deserializeBattleExact } from '../src/forward/serialize';
import { loadSimModsFor } from '../src/forward/sim-mods';

// `await loadSimModsFor(serialized)`, in a module graph of its own (vitest isolates files): nothing loaded it before.
const POSITIONS = {
  singles: 'gen9championsou-2693832490-t3',
  doubles: 'gen9championsvgc2026regmbbo3-2679053861-t3',
} as const;
const serialized = (id: string) => (JSON.parse(readFileSync(new URL(`./fixtures/champions/${id}.position.json`, import.meta.url), 'utf-8')) as { serialized: string }).serialized;

describe('a Champions position revives where only positions arrive', () => {
  for (const [kind, id] of Object.entries(POSITIONS)) {
    test(`loadSimModsFor, then the position plays on the Champions mod (${kind})`, async () => {
      const position = serialized(id);
      await loadSimModsFor(position);
      const battle = deserializeBattleExact(position);
      expect(battle.dex.currentMod).toBe('champions');
      expect(battle.gameType).toBe(kind);
      for (const side of battle.sides) for (const pokemon of side.pokemon) expect(pokemon.canTerastallize, pokemon.name).toBeFalsy();
    });
  }
});
