import { afterAll, describe, expect, test, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { hitsIn as hitsOfDex } from '../src/dice/chain';
import { secondariesIn } from '../src/dice/secondaries';
import { dexOfRules, SWEEP_CASES, sweepMoves, type DexMove } from './dice-sweep-support';
import { clickedOf, moveScene, type Scene } from './dice-logged-sweep-support';
import { sweepMovesOf, writeSummaries } from './dice-logged-sweep-rows';

/**
 * D9b (#125): the secondary and self-effect rows of the logged sweep (the accuracy rows, the small groups and the census stay in
 * `dice-logged-sweep.spec.ts`, which describes the sweep), a part of the former file under the same titles. Its helpers are in
 * `dice-logged-sweep-rows.ts`.
 */
await loadSimMods('gen9championsou');
// a full sweep plays every Dex move of a rule set in one test
vi.setConfig({ testTimeout: 900_000 });

afterAll(() => writeSummaries('secondary'));

describe.each(SWEEP_CASES)('the logged secondaries and self effects give the log\'s turn: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const secondaries = secondariesIn(dex);
  const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondaries, hitsOf: hitsOfDex(dex) });
  const entries = (move: DexMove): string[] => secondaries(move.id);
  const has = (kind: 'items' | 'abilities', id: string): boolean => { const entry = dex[kind].get(id); return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard; };

  const plain = (move: DexMove): boolean => entries(move).length > 0;
  const ownSelf = (move: DexMove): boolean => entries(move).some(id => id.startsWith('self:'));
  const sceneOf = (move: DexMove, outfit?: { ability: string }): Scene | null =>
    moveScene(rules, mode, move, { channels: ['secondaries', 'cants'], kind: 'secondary', options: options(move) }, outfit);

  test('secondary: every move with a chance entry', () => {
    const result = sweepMovesOf('secondary', rules, mode, plain, move => sceneOf(move));
    expect(result.failures).toEqual([]);
    expect(result.witnesses).toBeGreaterThan(0);
  });

  test('self-effect: every move whose chance entry moves its own user', () => {
    const keep = (move: DexMove): boolean => ownSelf(move);
    const result = sweepMovesOf('self-effect', rules, mode, keep, move => sceneOf(move));
    expect(result.failures).toEqual([]);
    // a rule set whose Dex has no such move plays none (Gen 1 has no stat change of the user as a secondary)
    expect(result.witnesses > 0 || sweepMoves(rules, keep).moves.length === 0).toBe(true);
  });

  // Serene Grace doubles the chances, Sheer Force removes the secondaries: the log shows what the simulator rolled under the outfit
  for (const outfit of [{ ability: 'serenegrace' }, { ability: 'sheerforce' }]) {
    test(`secondary under ${outfit.ability}`, () => {
      if (!has('abilities', outfit.ability)) return;
      const result = sweepMovesOf(outfit.ability, rules, mode, plain, move => sceneOf(move, outfit));
      expect(result.failures).toEqual([]);
    });
  }
});
