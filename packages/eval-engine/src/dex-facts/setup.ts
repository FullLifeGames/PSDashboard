/**
 * The pure self-boosting moves ("setup moves"), read from the Dex: a status move whose data field (`boosts` on a self move, or
 * `self.boosts`) raises its user's stats by two stages or more, evasion left out. Five moves apply their boosts in a handler and are
 * named below; test/setup-moves-oracle.spec.ts holds the list to the simulator. The module is in the app's main bundle, so it asks a
 * structural Dex (the data-only one of @pkmn/dex or the simulator's) and imports nothing.
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
// eslint-disable-next-line names/no-new-dex-name -- held by setup-moves-oracle.spec.ts: a handler applies these boosts, no data field names them
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
