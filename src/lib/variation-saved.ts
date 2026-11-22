import { loadSavedBranches, savedBranchOwner, type SavedBranch } from './branch-share';

/**
 * Round 89 (lane H, #105), H16a: whether the variation on screen is already saved. Save Branch writes the branch as a row under its
 * replay's or game's key; the variation counts as saved when a row there holds the same choices (a game's variation, version 2, also the same start turn:
 * its entries carry no turn numbers; a replay's branch, version 1, carries them in its choices). The row's time and the pointer's place are no part of it.
 */
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
