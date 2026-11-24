import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { restoreSideInvariants } from './serialize.ts';
import { assertSimMods } from './sim-mods.ts';
import { prepareBattle, prepareFormat } from './sim-fast/index.ts';

/** The search's parsed position: one JSON.parse per position, shared by every fork of it. */
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
  // The `set` objects (the Pokemon constructor normalizes them idempotently) are shared by every battle of this state;
  // the log array is shared too, and deserializeFromParsed replaces it per battle.
  state.log = [];
  state.inputLog = [];
  state.messageLog = [];
  state.sentLogPos = 0;
  state.lastMoveLine = -1;
  return { state, trims };
}

export function deserializeFromParsed(parsed: ParsedSearchState): Battle {
  assertSimMods(String(parsed.state.formatid));
  prepareFormat(String(parsed.state.formatid));
  const battle = State.deserializeBattle(parsed.state as never);
  for (const trim of parsed.trims) {
    battle.sides[trim.side].pokemon[trim.index].moveSlots.length = trim.length;
  }
  // The deserializer hands out the parsed log array itself: a fork appending to it would corrupt its siblings.
  (battle as unknown as { log: string[] }).log = [];
  restoreSideInvariants(battle);
  prepareBattle(battle);
  return battle;
}
