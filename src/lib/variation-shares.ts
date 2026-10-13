import type { BranchHistoryEntry } from './branch-history';

/**
 * The fainted share of the board an entry left behind: fainted bodies over all bodies of both sides, counting a body
 * at 0 HP as down. This is the engine's own phase measure (battleFaintedFraction) on the same rosters, so the number
 * the panel prints for the position and the K the search ran at read one board. No bodies: unknown.
 */
function boardShare(entry: BranchHistoryEntry): number | null {
  const bodies = [...entry.p1Pokemon, ...entry.p2Pokemon];
  if (bodies.length === 0) return null;
  return bodies.filter(body => body.fainted || body.hp <= 0).length / bodies.length;
}

/**
 * Round 70 (T216): the fainted share of the variation's own board before each turn, indexed like the variation
 * scores (shares[turn - 1]). Entry k plays turn startTurn + k and leaves the board that opens turn startTurn + k + 1;
 * a forced replacement consumes no turn, so the board after it replaces the one before (the same mapping as the
 * recorded position of a viewed variation turn). The shared prefix (startTurn and before) has no variation board:
 * only the main line's own share stands there, and those slots stay null.
 */
export function variationBoardShares(history: BranchHistoryEntry[], startTurn: number): (number | null)[] {
  const shares: (number | null)[] = Array.from({ length: startTurn }, () => null);
  let turn = startTurn;
  for (const entry of history) {
    if (entry.kind !== 'forced') turn += 1;
    if (turn > startTurn) shares[turn - 1] = boardShare(entry);
  }
  return shares;
}
