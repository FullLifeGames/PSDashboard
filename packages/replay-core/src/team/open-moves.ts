import type { RulesDex } from '../rules-dex.ts';
import type { OpenMove } from '../types.ts';

/** Open moves: a Z-move or Max move in the log hides its base move, and the set keeps a slot open for it (`RevealedPokemonInfo.openMoves`). */

export const sameOpenMove = (a: OpenMove, b: OpenMove): boolean =>
  a.kind === 'status' ? b.kind === 'status' : b.kind === 'attack' && a.type === b.type;

/** Whether the move can be the base move of the slot: a damaging move of the slot's type, or any status move for Max Guard's. */
export function fillsOpenMove(dex: RulesDex, open: OpenMove, moveName: string): boolean {
  const move = dex.moves.get(moveName);
  if (!move.exists) return false;
  return open.kind === 'status' ? move.category === 'Status' : move.category !== 'Status' && move.type === open.type;
}

export function unfilledOpenMoves(dex: RulesDex, open: readonly OpenMove[] | undefined, moves: readonly string[]): OpenMove[] {
  return (open ?? []).filter(slot => !moves.some(name => fillsOpenMove(dex, slot, name)));
}

/** A pool entry the settling reads: the move's name and whether it is a guess (a seen or user-set move is proof). */
interface OpenCandidate {
  name: string;
  guessed: boolean;
}

function pinFirst<T extends OpenCandidate>(pool: readonly T[], pinned: readonly T[]): T[] {
  return [...pool.filter(entry => !entry.guessed), ...pinned, ...pool.filter(entry => entry.guessed && !pinned.includes(entry))];
}

/**
 * The moves a set keeps, with the open slots filled. `assemble` is the caller's own assembly of a pool (the coherence vetoes and the cut to
 * four moves). A slot that a kept move fills stays as it is; otherwise the first guess of the pool, in the pool's order, that fits the slot and
 * survives the assembly moves up behind the proven moves: the slot is the log's evidence, so it outranks the guesses. A slot no guess fills stays open.
 */
export function settleOpenMoves<T extends OpenCandidate>(
  dex: RulesDex, pool: readonly T[], open: readonly OpenMove[] | undefined, assemble: (pool: T[]) => T[],
): T[] {
  let kept = assemble([...pool]);
  const pinned: T[] = [];
  const stuck = new Set<OpenMove>();
  // A pin takes a place and can push out the move that filled another slot: the loop looks at every slot again after each pin.
  for (;;) {
    const slot = (open ?? []).find(entry => !stuck.has(entry) && !kept.some(move => fillsOpenMove(dex, entry, move.name)));
    if (!slot) return kept;
    let settled = false;
    for (const candidate of pool) {
      if (!candidate.guessed || pinned.includes(candidate) || !fillsOpenMove(dex, slot, candidate.name)) continue;
      const trial = assemble(pinFirst(pool, [...pinned, candidate]));
      if (![...pinned, candidate].every(entry => trial.includes(entry))) continue;
      pinned.push(candidate);
      kept = trial;
      settled = true;
      break;
    }
    if (!settled) stuck.add(slot);
  }
}
