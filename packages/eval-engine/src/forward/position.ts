import type { Battle } from '@pkmn/sim';
import { deserializeRepaired, serializeBattleStable } from './serialize.ts';
import { repairFaintedActives } from './switches.ts';

/**
 * The immutable search position: a lazily serialized/deserialized battle
 * whose serialized string is its identity.
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

  constructor(serialized: string | null, battle: Battle | null) {
    this.serializedCache = serialized;
    this.battleCache = battle;
  }

  get serialized(): string {
    this.serializedCache ??= serializeBattleStable(this.battleCache!);
    return this.serializedCache;
  }

  getBattle(): Battle {
    if (!this.battleCache) {
      this.battleCache = deserializeRepaired(this.serializedCache!);
      repairFaintedActives(this.battleCache);
    }
    return this.battleCache;
  }
}

/** Fallback cache for foreign `{ serialized }` literals. */
const foreignBattleCache = new WeakMap<SimPosition, Battle>();

export function createRootPosition(serializedBattle: string): SimPosition {
  return new Position(serializedBattle, null);
}

/** Cached read-only deserialization — never mutate the returned battle. */
export function positionBattle(position: SimPosition): Battle {
  if (position instanceof Position) return position.getBattle();
  let battle = foreignBattleCache.get(position);
  if (!battle) {
    battle = deserializeRepaired(position.serialized);
    foreignBattleCache.set(position, battle);
  }
  return battle;
}

export function toPosition(battle: Battle): SimPosition {
  return new Position(null, battle);
}
