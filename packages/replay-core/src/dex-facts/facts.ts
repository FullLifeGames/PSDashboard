import type { Dex } from '@pkmn/sim';

/**
 * Round 72 (T235): what the engine and the inference know about a Dex, found once. One table per Dex object, in the shape of
 * eval-engine's score/contact-filter.ts `factsOf`: a WeakMap keyed by the Dex (the battle's `dex`, `Dex.forGen(n)` or the
 * Champions mod), filled on the first question, so a hot path pays one map read. The table holds no species, move, item or
 * ability name: every id comes from a scan of the Dex, and test/dex-facts-lists.spec.ts holds each scan to the hand list it
 * replaced in every generation and the Champions mod.
 */
export type FactsDex = typeof Dex;

// eslint-disable-next-line names/no-new-dex-name -- 'stall' is a ProtectKind (the simulator's stall counter), not the ability Stall
export type ProtectKind = 'shield' | 'stall' | 'side';

export interface DexRuleFacts {
  /** The Protect family per move id (null: not a member). */
  protect: Map<string, ProtectKind | null>;
  /** Id sets found by a scan of the Dex, per fact. */
  sets: Map<string, ReadonlySet<string>>;
}

const facts = new WeakMap<object, DexRuleFacts>();
/** The Dex asked last: a search asks about one Dex thousands of times, so the common ask costs a comparison. */
let lastDex: FactsDex | null = null;
let lastFacts: DexRuleFacts | null = null;

export function factsOfDex(dex: FactsDex): DexRuleFacts {
  if (dex === lastDex) return lastFacts!;
  let known = facts.get(dex);
  if (!known) {
    known = { protect: new Map(), sets: new Map() };
    facts.set(dex, known);
  }
  lastDex = dex;
  lastFacts = known;
  return known;
}

/** The ids a scan finds, scanned once per Dex. */
export function idsOf(dex: FactsDex, fact: string, scan: (dex: FactsDex) => Iterable<string>): ReadonlySet<string> {
  const known = factsOfDex(dex);
  let ids = known.sets.get(fact);
  if (!ids) known.sets.set(fact, ids = new Set(scan(dex)));
  return ids;
}

/** Whether the Dex entry carries a handler for one of the events. */
export const hasHandler = (effect: unknown, events: readonly string[]): boolean =>
  events.some(event => typeof (effect as Record<string, unknown>)[event] === 'function');
