import { loadSavedBranches, savedBranchOwner, type SavedBranch } from './branch-share';

// A game's variation (version 2) also compares the start turn: its entries carry no turn numbers, a replay's do.
function sameLine(row: SavedBranch, current: SavedBranch): boolean {
  if (current.version === 2) {
    return row.version === 2 && row.variation?.startTurn === current.variation?.startTurn
      && JSON.stringify(row.variation?.entries) === JSON.stringify(current.variation?.entries);
  }
  return row.version === 1 && JSON.stringify(row.choices) === JSON.stringify(current.choices);
}

export function variationSaved(current: SavedBranch): boolean {
  return loadSavedBranches(savedBranchOwner(current)).some(row => sameLine(row, current));
}
