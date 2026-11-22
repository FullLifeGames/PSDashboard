import { PRNG } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice } from '../src/dice/offer';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, type Mode, type Rules } from './dice-fixtures';
import { clicksAccepted, dexOfRules, outfitBoard, SWEEP_CASES, sweepClicks, sweepMoves, type DexMove } from './dice-sweep-support';

// Round 89 (#114, ruling 34 F4a): a holder whose ability or item fixes the hit count of a variable multi-hit move (Skill Link, Loaded
// Dice) gets one row without a choice: the offer carries a die of the kind `hit-count` with the one count the simulator plays and
// `fixedBy`, the name of the ability or item from the Dex. The oracle plays the turn on copies with six seeds and reads `|-hitcount|`:
// the offer names a fixed count exactly when every played count is one value. For every ability and item of the Dex that has an
// `onModifyMove` handler (the only entries that can rewrite a move), every variable move (a range of hits, or the Dex flag
// `multiaccuracy`), in every rule set the corpus plays, singles and doubles.
await loadSimMods('gen9championsou');

const FAST = 'Pikachu';
// sixteen unrelated seeds from a linear congruence: a chain of per-hit accuracy rolls (90 %) lands every hit on all of them with chance 0.7 %
const SEEDS = Array.from({ length: 16 }, (_, index) => [1, 2, 3, 4].map((_, part) => (Math.imul(index * 4 + part + 1, 2654435761) >>> 0) % 1000003));
const variable = (move: DexMove): boolean => {
  const { multihit, multiaccuracy } = move as unknown as { multihit?: number | number[]; multiaccuracy?: boolean };
  return Array.isArray(multihit) || !!multiaccuracy;
};

type Holder = { kind: 'abilities' | 'items'; id: string; name: string };

/** The abilities and items of the rule set whose handler can rewrite a move. */
function rewriters(rules: Rules): Holder[] {
  const dex = dexOfRules(rules);
  const keep = (entry: { exists: boolean; gen: number; isNonstandard?: string | null }): boolean => entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
  const has = (entry: unknown): boolean => typeof (entry as { onModifyMove?: unknown }).onModifyMove === 'function';
  return [
    ...dex.abilities.all().filter(entry => keep(entry) && has(entry)).map((entry): Holder => ({ kind: 'abilities', id: entry.id, name: entry.name })),
    ...dex.items.all().filter(entry => keep(entry) && has(entry)).map((entry): Holder => ({ kind: 'items', id: entry.id, name: entry.name })),
  ];
}

/** The counts of the `|-hitcount|` lines the turn shows on copies of the board, one entry per seed that landed the move. */
function playedCounts(board: ReturnType<typeof outfitBoard>, clicks: { p1: string; p2: string }): number[] {
  return SEEDS.flatMap(seed => {
    const copy = copyOf(board);
    copy.prng = new PRNG(seed as [number, number, number, number]);
    const start = copy.log.length;
    playClicks(copy, clicks);
    return copy.log.slice(start).filter(line => line.startsWith('|-hitcount|p2')).map(line => Number(line.split('|')[3]));
  });
}

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('the offer names a fixed hit count: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, variable);
  const holders = rewriters(rules);
  const choiceOf = (move: DexMove) => ({ kind: 'move' as const, moveId: move.id, moveName: move.name, ...(mode === 'doubles' ? { targetLoc: 1 } : {}) });
  const boardOf = (move: DexMove, holder: Holder | undefined) =>
    outfitBoard(rules, mode as Mode, { species: FAST, moves: [move.id], ...(holder?.kind === 'abilities' ? { ability: holder.name } : {}), ...(holder?.kind === 'items' ? { item: holder.name } : {}) }, { species: 'Blissey' });

  test('a move with no holder has no fixed row', () => {
    for (const move of moves) {
      const board = boardOf(move, undefined);
      if (!clicksAccepted(board, sweepClicks(mode, move.target))) continue;
      expect(offeredDice(board, 'p1a', choiceOf(move)).filter(offer => offer.fixedBy !== undefined), move.id).toEqual([]);
    }
  });

  test('every ability and item that can rewrite a move: a fixed row names the holder and the count the turn plays, and a count the turn plays on every seed is named', () => {
    const named = new Map<string, number>();
    for (const holder of holders) {
      for (const move of moves) {
        const board = boardOf(move, holder);
        const clicks = sweepClicks(mode, move.target);
        if (!clicksAccepted(board, clicks)) continue;
        const fixed = offeredDice(board, 'p1a', choiceOf(move)).filter(offer => offer.fixedBy !== undefined);
        const counts = playedCounts(board, clicks);
        const label = `${move.id} with ${holder.name}`;
        // the simulator plays one count on every seed exactly when the offer names it
        const one = counts.length >= 6 && new Set(counts).size === 1 && counts[0] >= 2;
        expect(fixed.length, `${label}: counts ${JSON.stringify(counts)}`).toBe(one ? 1 : 0);
        if (fixed.length === 0) continue;
        named.set(holder.id, (named.get(holder.id) ?? 0) + 1);
        expect(fixed[0].fixedBy, label).toBe(holder.name);
        expect(fixed[0].name, label).toEqual({ slot: 'p1a', moveId: move.id, kind: 'hit-count' });
        expect(fixed[0].results, label).toEqual([{ hits: counts[0] }]);
      }
    }
    // Skill Link fixes every variable move
    if (holders.some(holder => holder.id === 'skilllink')) expect(named.get('skilllink'), 'rows of Skill Link').toBe(moves.length);
  });
});
