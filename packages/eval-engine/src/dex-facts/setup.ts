// A status move whose data fields raise its user's stats by two stages or more, evasion left out (setup-moves-oracle).
// In the app's main bundle: it asks a structural Dex and imports nothing.
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

// oracle: packages/eval-engine/test/setup-moves-oracle.spec.ts
// eslint-disable-next-line names/no-new-dex-name -- held by setup-moves-oracle.spec.ts: a handler applies these boosts, no data field names them
export const CODED_SETUP_MOVES: readonly string[] = ['bellydrum', 'curse', 'stockpile', 'takeheart', 'tidyup'];

export function fieldStages(move: SetupMove): number {
  const boosts = (move.target === 'self' ? move.boosts : undefined) ?? move.self?.boosts;
  if (!boosts) return 0;
  return Object.entries(boosts).filter(([stat, stage]) => stat !== 'evasion' && (stage ?? 0) > 0).reduce((sum, [, stage]) => sum + (stage ?? 0), 0);
}

const memo = new WeakMap<object, ReadonlySet<string>>();

export function setupMoves(dex: SetupDex): ReadonlySet<string> {
  let ids = memo.get(dex);
  if (!ids) {
    const fromFields = dex.moves.all().filter(move => move.exists && !move.isMax && !move.isZ && move.category === 'Status' && fieldStages(move) >= 2);
    memo.set(dex, ids = new Set([...fromFields.map(move => move.id), ...CODED_SETUP_MOVES.filter(id => dex.moves.all().some(move => move.id === id && move.exists))]));
  }
  return ids;
}
