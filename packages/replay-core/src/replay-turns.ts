import type { TurnSnapshot } from './types.ts';

// Its own module with a type-only parser import, so the main chunk reads it without pulling the protocol parser out of its lazy import.

// The parser pushes one snapshot per |turn| marker plus one end entry, stamped lastTurn + 1, when lines follow the final marker (the
// post-game state); that entry is no turn, and a log that ends on a |turn| marker has none.
/** The last turn the game played: the turn count of a replay without its post-game end entry. */
export function finalPlayedTurn(snapshots: TurnSnapshot[]): number {
  if (snapshots.length === 0) return 1;
  // Counting the end entry read '67 of 68 turns reconstructed' on a faithful replay of 67 turns that carries 68 snapshots.
  const last = snapshots[snapshots.length - 1];
  const isEndEntry = !last.log.some(line => line.startsWith('|turn|'));
  return Math.max(1, isEndEntry ? last.turn - 1 : last.turn);
}
