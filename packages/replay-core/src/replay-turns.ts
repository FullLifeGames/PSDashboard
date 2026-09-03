import type { TurnSnapshot } from './types.ts';

/**
 * The last turn the game actually PLAYED. The protocol parser pushes one
 * snapshot per |turn| marker, plus one trailing entry — stamped
 * lastTurn + 1 — whenever lines follow the final marker (the last turn's
 * actions and the |win|: the POST-GAME state). That end entry is a
 * position after the game, not a turn: the branch UI blocks it as a
 * target and shows it as its "End" sentinel, and the sweep must not count
 * it either — counting it manufactured a phantom final turn that can
 * never have a live position (the draft replay plays 67 turns, carries 68
 * snapshots, and reported "67 of 68 turns reconstructed" on a perfectly
 * faithful replay, 2026-08-13). A log that ends exactly ON a |turn|
 * marker has no end entry; every snapshot is then a real turn.
 *
 * Lives in its own module (type-only parser import) so the main chunk can
 * use it without pulling the protocol parser out of its lazy import.
 */
export function finalPlayedTurn(snapshots: TurnSnapshot[]): number {
  if (snapshots.length === 0) return 1;
  const last = snapshots[snapshots.length - 1];
  const isEndEntry = !last.log.some(line => line.startsWith('|turn|'));
  return Math.max(1, isEndEntry ? last.turn - 1 : last.turn);
}
