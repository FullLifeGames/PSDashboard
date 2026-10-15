// Data-only Dex, like move-slots.ts: this module rides into the app's MAIN bundle through the team-info enrichment.
import { Dex } from '@pkmn/dex';
import type { OpenMove } from '../types.ts';

/**
 * Open moves (round 70, batch fix): a Z-move or Max move in the log hides its base move, and the set keeps a slot open for it
 * (`RevealedPokemonInfo.openMoves`). A move fills a slot when its Dex category and type fit: a damaging move of the slot's type, or any
 * status move for Max Guard's. The set builder and the panel's enrichment settle the slots the same way.
 */

/** Whether two open moves ask for the same base move. */
export const sameOpenMove = (a: OpenMove, b: OpenMove): boolean =>
  a.kind === 'status' ? b.kind === 'status' : b.kind === 'attack' && a.type === b.type;

/** Whether the move can be the base move the slot stands for. */
export function fillsOpenMove(open: OpenMove, moveName: string): boolean {
  const move = Dex.moves.get(moveName);
  if (!move.exists) return false;
  return open.kind === 'status' ? move.category === 'Status' : move.category !== 'Status' && move.type === open.type;
}

/** The open moves that none of the moves fills. */
export function unfilledOpenMoves(open: readonly OpenMove[] | undefined, moves: readonly string[]): OpenMove[] {
  return (open ?? []).filter(slot => !moves.some(name => fillsOpenMove(slot, name)));
}

/** A pool entry the settling reads: the move's name and whether it is a guess (a seen or user-set move is proof). */
interface OpenCandidate {
  name: string;
  guessed: boolean;
}

/** The pool with `pinned` ahead of the other guesses, right behind the proven moves. */
function pinFirst<T extends OpenCandidate>(pool: readonly T[], pinned: readonly T[]): T[] {
  return [...pool.filter(entry => !entry.guessed), ...pinned, ...pool.filter(entry => entry.guessed && !pinned.includes(entry))];
}

/**
 * The moves a set keeps, with the open slots filled. `assemble` is the caller's own assembly of a pool (the coherence vetoes and the
 * cut to four moves). A slot that a kept move already fills stays as it is. Otherwise the first guess of the pool, in the pool's own
 * order (the chosen set, the earlier guesses, usage), that fits the slot and survives the assembly moves up behind the proven moves:
 * the slot is the log's evidence, so it outranks the guesses that would have used the room. A slot no guess fills stays open.
 */
export function settleOpenMoves<T extends OpenCandidate>(
  pool: readonly T[], open: readonly OpenMove[] | undefined, assemble: (pool: T[]) => T[],
): T[] {
  let kept = assemble([...pool]);
  const pinned: T[] = [];
  const stuck = new Set<OpenMove>();
  // A pin takes a place and can push out the move that filled another slot: the loop looks at every slot again after each pin.
  for (;;) {
    const slot = (open ?? []).find(entry => !stuck.has(entry) && !kept.some(move => fillsOpenMove(entry, move.name)));
    if (!slot) return kept;
    let settled = false;
    for (const candidate of pool) {
      if (!candidate.guessed || pinned.includes(candidate) || !fillsOpenMove(slot, candidate.name)) continue;
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
