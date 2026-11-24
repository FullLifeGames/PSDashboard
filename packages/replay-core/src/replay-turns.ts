import type { TurnSnapshot } from './types.ts';

// Its own module with a type-only parser import: the main chunk reads it without pulling in the lazy protocol parser.

/** The last turn the game played: the turn count of a replay without its post-game end entry. */
export function finalPlayedTurn(snapshots: TurnSnapshot[]): number {
  if (snapshots.length === 0) return 1;
  const last = snapshots[snapshots.length - 1];
  const isEndEntry = !last.log.some(line => line.startsWith('|turn|'));
  return Math.max(1, isEndEntry ? last.turn - 1 : last.turn);
}
