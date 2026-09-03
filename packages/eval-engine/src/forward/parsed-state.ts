import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { restoreSideInvariants } from './serialize.ts';

/**
 * The search's parsed position: JSON.parse once per position, the moveSlots
 * padding the sim's deserializer needs (see deserializeBattleExact), and the
 * history stripped. The sim reads `log` only to send updates (sentLogPos),
 * to attribute the move line it just wrote (lastMoveLine, which every
 * addMove sets fresh), and for debug output; `inputLog` and `messageLog` it
 * only writes. The search reads the log DELTA of one advance
 * (battle.log.slice(logStart)), which is the same from an empty start.
 * Forks share one parsed object because State.deserializeBattle rebuilds
 * every object it walks; the two shared pieces are the `set` objects, which
 * the Pokemon constructor normalizes idempotently, and the log array, which
 * deserializeFromParsed replaces per battle.
 */
export interface ParsedSearchState {
  state: Record<string, unknown>;
  /** moveSlots the padding lengthened, trimmed back on every battle. */
  trims: { side: number; index: number; length: number }[];
}

export function parseSearchState(serialized: string): ParsedSearchState {
  const state = JSON.parse(serialized) as Record<string, unknown> & {
    sides?: { pokemon?: { moveSlots?: unknown[]; baseMoveSlots?: unknown[] }[] }[];
  };
  const trims: ParsedSearchState['trims'] = [];
  state.sides?.forEach((side, sideIndex) => side.pokemon?.forEach((pokemon, index) => {
    const base = pokemon.baseMoveSlots;
    const slots = pokemon.moveSlots;
    if (!Array.isArray(base) || !Array.isArray(slots) || base.length <= slots.length) return;
    trims.push({ side: sideIndex, index, length: slots.length });
    while (slots.length < base.length) slots.push(base[slots.length]);
  }));
  state.log = [];
  state.inputLog = [];
  state.messageLog = [];
  state.sentLogPos = 0;
  state.lastMoveLine = -1;
  return { state, trims };
}

/** A fresh battle from the parsed state, with the search's side invariants restored. */
export function deserializeFromParsed(parsed: ParsedSearchState): Battle {
  const battle = State.deserializeBattle(parsed.state as never);
  for (const trim of parsed.trims) {
    battle.sides[trim.side].pokemon[trim.index].moveSlots.length = trim.length;
  }
  // The deserializer hands the battle the parsed log array itself; a fork
  // must never append into the object its siblings start from. The sim
  // types the field read-only; its own deserializer assigns it the same way.
  (battle as unknown as { log: string[] }).log = [];
  restoreSideInvariants(battle);
  return battle;
}
