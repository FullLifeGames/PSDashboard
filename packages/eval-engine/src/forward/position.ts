import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { deserializeFromParsed, parseSearchState, type ParsedSearchState } from './parsed-state.ts';
import { serializeBattleStable } from './serialize.ts';
import { repairFaintedActives } from './switches.ts';

/**
 * The immutable search position: a lazily serialized/deserialized battle
 * whose serialized string is its identity. Forks start from the position's
 * parsed state (parsed once, history stripped; parsed-state.ts), so a
 * position that fans out into many children pays the JSON parse once.
 */

export interface ChoiceOption {
  /** Sim choice string, accepted verbatim by Battle#choose. */
  choice: string;
  label: string;
}

/**
 * An immutable battle position. The serialized string is the identity, but it
 * is computed lazily — depth-1 leaf children are only ever evaluated, and
 * serializing them would double the cost of every fork for nothing.
 */
export interface SimPosition {
  readonly serialized: string;
}

class Position implements SimPosition {
  private serializedCache: string | null;
  private battleCache: Battle | null;
  private parsedCache: ParsedSearchState | null = null;

  constructor(serialized: string | null, battle: Battle | null) {
    this.serializedCache = serialized;
    this.battleCache = battle;
  }

  get serialized(): string {
    this.serializedCache ??= serializeBattleStable(this.battleCache!);
    return this.serializedCache;
  }

  getParsed(): ParsedSearchState {
    this.parsedCache ??= parseSearchState(this.serialized);
    return this.parsedCache;
  }

  getBattle(): Battle {
    if (!this.battleCache) {
      this.battleCache = deserializeFromParsed(this.getParsed());
      repairFaintedActives(this.battleCache);
    }
    return this.battleCache;
  }
}

/** Fallback caches for foreign `{ serialized }` literals. */
const foreignParsedCache = new WeakMap<SimPosition, ParsedSearchState>();
const foreignBattleCache = new WeakMap<SimPosition, Battle>();

export function createRootPosition(serializedBattle: string): SimPosition {
  return new Position(serializedBattle, null);
}

/** The parsed state every fork of the position starts from (one parse per position). */
function positionParsed(position: SimPosition): ParsedSearchState {
  if (position instanceof Position) return position.getParsed();
  let parsed = foreignParsedCache.get(position);
  if (!parsed) {
    parsed = parseSearchState(position.serialized);
    foreignParsedCache.set(position, parsed);
  }
  return parsed;
}

/** Cached read-only deserialization — never mutate the returned battle. */
export function positionBattle(position: SimPosition): Battle {
  if (position instanceof Position) return position.getBattle();
  let battle = foreignBattleCache.get(position);
  if (!battle) {
    battle = deserializeFromParsed(positionParsed(position));
    foreignBattleCache.set(position, battle);
  }
  return battle;
}

/**
 * A fresh battle from the position's parsed state, seeded so the advance is
 * reproducible. Siblings share the parsed state, never a battle.
 */
export function forkBattle(position: SimPosition, seed: PRNGSeed): Battle {
  const battle = deserializeFromParsed(positionParsed(position));
  battle.prng = new PRNG(seed);
  repairFaintedActives(battle);
  return battle;
}

export function toPosition(battle: Battle): SimPosition {
  return new Position(null, battle);
}
