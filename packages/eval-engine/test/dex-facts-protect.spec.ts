import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { protectKind } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { shieldsFromHits, shieldsSide } from '../src/search/hints';
import { rollsStall, stopsHits } from '../src/dex-facts/protect';

/**
 * Round 72 (T235): the Protect family in one predicate. Five readers held five forms of the same rule (damage-calc.ts
 * shieldedBy, pair/guards.ts rollsStall, search/hints.ts shieldsFromHits and shieldsSide, cell-blend.ts stopsHits). The
 * forms below are the old ones, copied from the code before the change; the sweep plays every move of Generations 1 to 9 and
 * of the Champions mod through all of them and through `protectKind` (replay-core dex-facts), Max and Z moves included, and
 * requires the same answer for every move in every view.
 */

await loadSimMods('gen9championsou');

type ModdedDex = typeof Dex;
type DexMove = ReturnType<ModdedDex['moves']['get']>;

const VIEWS: { name: string; dex: ModdedDex }[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Gen ${gen}`, dex: Dex.forGen(gen) })),
  { name: 'Champions', dex: Dex.mod('champions') },
];

const oldShieldsFromHits = (dex: ModdedDex, move: DexMove) =>
  move.target === 'self' && !!move.stallingMove && !!move.volatileStatus && 'onTryHit' in dex.conditions.get(move.volatileStatus);
const oldShieldsSide = (dex: ModdedDex, move: DexMove) =>
  move.target === 'allySide' && !!move.sideCondition && 'onTryHit' in dex.conditions.get(move.sideCondition);
const oldRollsStall = (move: DexMove) => move.target === 'self' && !!move.stallingMove && !!move.volatileStatus;
const oldStopsHits = (dex: ModdedDex, move: DexMove) => !!move.stallingMove || oldShieldsSide(dex, move);
/** damage-calc.ts shieldedBy before its priority and Unseen Fist conditions: no target test. */
const oldShieldedBy = (dex: ModdedDex, move: DexMove) =>
  !(!move.stallingMove || !move.volatileStatus) && 'onTryHit' in dex.conditions.get(move.volatileStatus);

describe.each(VIEWS)('$name: protectKind against the five old forms', ({ dex }) => {
  const moves = dex.moves.all();

  test('every move answers as the old forms did', () => {
    expect(moves.length).toBeGreaterThan(100);
    const differing: string[] = [];
    for (const move of moves) {
      const kind = protectKind(dex, move);
      const same =
        (kind === 'shield') === oldShieldsFromHits(dex, move) &&
        (kind === 'shield') === oldShieldedBy(dex, move) &&
        (kind === 'side') === oldShieldsSide(dex, move) &&
        (kind === 'shield' || kind === 'stall') === oldRollsStall(move) &&
        (kind !== null) === oldStopsHits(dex, move);
      if (!same) differing.push(`${move.id}:${kind}`);
    }
    expect(differing).toEqual([]);
  });

  test('the readers of the engine give the old answers', () => {
    const differing: string[] = [];
    for (const move of moves) {
      const same =
        shieldsFromHits(dex, move) === oldShieldsFromHits(dex, move) &&
        shieldsSide(dex, move) === oldShieldsSide(dex, move) &&
        rollsStall(dex, move) === oldRollsStall(move) &&
        stopsHits(dex, move) === oldStopsHits(dex, move);
      if (!same) differing.push(move.id);
    }
    expect(differing).toEqual([]);
  });

  test('the family is not empty and Max Guard shields like Protect', () => {
    const kinds = new Set(moves.map(move => protectKind(dex, move)));
    expect(kinds).toEqual(new Set(['shield', 'stall', 'side', null]));
    expect(moves.filter(move => protectKind(dex, move) !== null).length).toBeGreaterThan(10);
    const maxGuard = moves.find(move => move.isMax && move.stallingMove);
    expect(maxGuard && protectKind(dex, maxGuard)).toBe('shield');
  });

  test('a move that does not exist has no kind', () => {
    expect(protectKind(dex, dex.moves.get('notamove'))).toBeNull();
  });
});
