import type { BranchHistoryEntry } from './branch-history';
import { isInterlude } from './variation-turns';

/**
 * The fainted share of the board an entry left behind (fainted over all bodies of both sides): the engine's phase measure
 * `battleFaintedFraction`, so the panel's number and the search's K read one board. No bodies: unknown.
 */
function boardShare(entry: BranchHistoryEntry): number | null {
  const bodies = [...entry.p1Pokemon, ...entry.p2Pokemon];
  if (bodies.length === 0) return null;
  return bodies.filter(body => body.fainted || body.hp <= 0).length / bodies.length;
}

/**
 * The fainted share of the variation's own board before each turn, indexed like the variation scores (shares[turn - 1]). Entry k
 * plays turn startTurn + k and leaves the board that opens turn startTurn + k + 1; a replacement consumes no turn, so the board after
 * it replaces the one before. The shared prefix (startTurn and before) has no variation board: those slots stay null.
 */
export function variationBoardShares(history: BranchHistoryEntry[], startTurn: number): (number | null)[] {
  const shares: (number | null)[] = Array.from({ length: startTurn }, () => null);
  let turn = startTurn;
  history.forEach((entry, index) => {
    if (!isInterlude(history, index)) turn += 1;
    if (turn > startTurn) shares[turn - 1] = boardShare(entry);
  });
  return shares;
}
