/**
 * Round 72 (T235, finding W2): the pure self-boosting moves ("setup moves"), read from the Dex. The Dex states a boost in a data
 * field for most of them: a status move that raises its user's stats (`boosts` on a self move, or `self.boosts`) by two stages or
 * more, evasion left out. Five moves apply their boosts in a handler, where the data holds no field; they are named below and
 * test/setup-moves-oracle.spec.ts holds the list to the simulator (it plays every status move and requires the set to be the
 * moves that leave their user two stages up) and holds each name to a move no field covers.
 *
 * This module is in the app's main bundle through turn-analysis/played-match.ts, so it asks a structural Dex (the data-only one
 * of @pkmn/dex or the simulator's) and imports nothing.
 */
interface BoostFields { [stat: string]: number | undefined }

interface SetupMove {
  id: string;
  exists: boolean;
  category: string;
  target: string;
  isMax?: unknown;
  isZ?: unknown;
  boosts?: BoostFields;
  self?: { boosts?: BoostFields } | null;
}

export interface SetupDex { moves: { all(): readonly SetupMove[] } }

/** Moves whose boosts a handler applies (Belly Drum, Curse, Stockpile, Take Heart, Tidy Up): no data field says them. */
// oracle: packages/eval-engine/test/setup-moves-oracle.spec.ts
export const CODED_SETUP_MOVES: readonly string[] = ['bellydrum', 'curse', 'stockpile', 'takeheart', 'tidyup'];

/** The stages a move's data fields give its user: every positive boost of a self move, evasion left out. */
export function fieldStages(move: SetupMove): number {
  const boosts = (move.target === 'self' ? move.boosts : undefined) ?? move.self?.boosts;
  if (!boosts) return 0;
  return Object.entries(boosts).filter(([stat, stage]) => stat !== 'evasion' && (stage ?? 0) > 0).reduce((sum, [, stage]) => sum + (stage ?? 0), 0);
}

const memo = new WeakMap<object, ReadonlySet<string>>();

/** The ids of the setup moves of a Dex: status moves whose fields give the user two stages or more, plus the handler moves. */
export function setupMoves(dex: SetupDex): ReadonlySet<string> {
  let ids = memo.get(dex);
  if (!ids) {
    const fromFields = dex.moves.all().filter(move => move.exists && !move.isMax && !move.isZ && move.category === 'Status' && fieldStages(move) >= 2);
    memo.set(dex, ids = new Set([...fromFields.map(move => move.id), ...CODED_SETUP_MOVES.filter(id => dex.moves.all().some(move => move.id === id && move.exists))]));
  }
  return ids;
}
