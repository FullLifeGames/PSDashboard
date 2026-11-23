import type { Dex } from '@pkmn/sim';

/** The Dex the rule facts are read over: one table per Dex object, filled by scans of the Dex on the first question and holding no species, move, item or ability name. */
export type FactsDex = typeof Dex;

/** The Protect family of a move: `shield` (Protect, the King's Shield kin, Max Guard), `stall` (Endure) or `side` (Wide Guard, Quick Guard, Crafty Shield, Mat Block). */
// eslint-disable-next-line names/no-new-dex-name -- 'stall' is a ProtectKind (the simulator's stall counter), not the ability Stall
export type ProtectKind = 'shield' | 'stall' | 'side';

export interface DexRuleFacts {
  protect: Map<string, ProtectKind | null>;
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
