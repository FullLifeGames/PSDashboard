import type { BranchHistoryEntry } from './branch-history';
import { isInterlude } from './variation-turns';

// The engine's phase measure `battleFaintedFraction`, so the panel's number and the search's K read one board.
function boardShare(entry: BranchHistoryEntry): number | null {
  const bodies = [...entry.p1Pokemon, ...entry.p2Pokemon];
  if (bodies.length === 0) return null;
  return bodies.filter(body => body.fainted || body.hp <= 0).length / bodies.length;
}

// Indexed like the variation scores (shares[turn - 1]); a replacement consumes no turn: its board replaces the last.
// The shared prefix (startTurn and before) has no variation board: those slots stay null.
export function variationBoardShares(history: BranchHistoryEntry[], startTurn: number): (number | null)[] {
  const shares: (number | null)[] = Array.from({ length: startTurn }, () => null);
  let turn = startTurn;
  history.forEach((entry, index) => {
    if (!isInterlude(history, index)) turn += 1;
    if (turn > startTurn) shares[turn - 1] = boardShare(entry);
  });
  return shares;
}
