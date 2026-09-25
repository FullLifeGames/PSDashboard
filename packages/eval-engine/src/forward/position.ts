import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { deserializeFromParsed, parseSearchState, type ParsedSearchState } from './parsed-state.ts';
import { restoreSideInvariants, serializeBattleStable } from './serialize.ts';
import { adoptTemplate, copyBattle, prepareBattle, simFastOn } from './sim-fast/index.ts';
import { repairFaintedActives } from './switches.ts';
import { ScriptedPRNG, type RollScripts } from './scripted-prng.ts';

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
  private templateCache: Battle | null = null;
  /** Built around a live battle (a child), not around a string (a root). */
  private readonly live: boolean;

  constructor(serialized: string | null, battle: Battle | null) {
    this.serializedCache = serialized;
    this.battleCache = battle;
    this.live = battle !== null;
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

  /**
   * Round 59 (lever clone): the battle forks copy, never handed to readers
   * and never written. A root's template is its own unrepaired
   * deserialization (the reader's battle is repaired); a child's is a copy of
   * its battle at the first fork, the moment today's path serializes it.
   */
  template(): Battle | null {
    if (!this.templateCache) {
      const template = this.live ? copyBattle(this.battleCache!) : deserializeFromParsed(this.getParsed());
      if (!template) return null;
      this.templateCache = adoptTemplate(template);
    }
    return this.templateCache;
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

/** A fresh, unseeded, unrepaired battle of the position: a copy of its template, or today's deserialization. */
function freshBattle(position: SimPosition): Battle {
  if (position instanceof Position && simFastOn('clone')) {
    const template = position.template();
    const copy = template && copyBattle(template);
    if (copy) {
      restoreSideInvariants(copy);
      prepareBattle(copy);
      return copy;
    }
  }
  return deserializeFromParsed(positionParsed(position));
}

/**
 * A fresh battle from the position's parsed state, seeded so the advance is
 * reproducible. Siblings share the parsed state, never a battle. Round 43:
 * with scripts the dice of the named moves answer on demand.
 */
export function forkBattle(position: SimPosition, seed: PRNGSeed, scripts?: RollScripts): Battle {
  const battle = freshBattle(position);
  if (scripts && scripts.size > 0) {
    const prng = new ScriptedPRNG(seed, scripts);
    prng.attach(battle);
    battle.prng = prng;
  } else {
    battle.prng = new PRNG(seed);
  }
  repairFaintedActives(battle);
  return battle;
}

/**
 * Round 56: a fork whose dice are the given PRNG — the doubles pair plan's
 * recorder attaches itself to the battle it rolls for.
 */
export function forkBattleWithPrng(position: SimPosition, prng: PRNG & { attach(battle: Battle): void }): Battle {
  const battle = freshBattle(position);
  prng.attach(battle);
  battle.prng = prng;
  repairFaintedActives(battle);
  return battle;
}

export function toPosition(battle: Battle): SimPosition {
  return new Position(null, battle);
}
