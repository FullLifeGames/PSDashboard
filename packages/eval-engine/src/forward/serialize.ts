import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { assertSimMods } from './sim-mods.ts';

// Battle serialization for positions: the stable identity string, the exact deserializer and the side-invariant restore.

/** Serializes without the sim's wall-clock `|t:|` log lines, which made identical advances across a second boundary differ. */
export function serializeBattleStable(battle: Battle): string {
  const state = State.serializeBattle(battle) as { log?: string[] };
  if (Array.isArray(state.log)) state.log = state.log.filter(line => !line.startsWith('|t:|'));
  return JSON.stringify(state);
}

/** Deserializes a battle with exact fidelity: only the moveSlots padding below, no invariant restoration (for harness clone-and-correct paths). */
export function deserializeBattleExact(serialized: string): Battle {
  const state = JSON.parse(serialized) as {
    formatid?: string;
    sides?: { pokemon?: { moveSlots?: unknown[]; baseMoveSlots?: unknown[] }[] }[];
  };
  assertSimMods(state.formatid ?? '');
  // @pkmn/sim's deserializer walks baseMoveSlots indexing moveSlots; a transformed mon that copied a partially revealed target has
  // fewer moveSlots than base, and the walk crashes on the missing tail ("reading 'id'"; Imprison-Transform Mew). Pad a parsed
  // copy up to base length, deserialize, trim the live arrays back: the battle round-trips exactly and the string stays the key.
  const trims: { side: number; index: number; length: number }[] = [];
  state.sides?.forEach((side, sideIndex) => side.pokemon?.forEach((pokemon, index) => {
    const base = pokemon.baseMoveSlots;
    const slots = pokemon.moveSlots;
    if (!Array.isArray(base) || !Array.isArray(slots) || base.length <= slots.length) return;
    trims.push({ side: sideIndex, index, length: slots.length });
    while (slots.length < base.length) slots.push(base[slots.length]);
  }));
  const battle = State.deserializeBattle(state as never);
  for (const trim of trims) {
    battle.sides[trim.side].pokemon[trim.index].moveSlots.length = trim.length;
  }
  return battle;
}

/**
 * Recomputes side state the sim runs on from ground truth after every correction pass and deserialize: `pokemonLeft` is the win-check
 * counter (drifted high, a wiped side plays on behind a stale move request) and `isActive` drives bench enumeration (drifted false
 * on the active, "switch 1" targeted the field).
 */
export function restoreSideInvariants(battle: Battle): void {
  for (const side of battle.sides) {
    side.pokemonLeft = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0).length;
    for (const pokemon of side.pokemon) {
      pokemon.isActive = side.active.includes(pokemon);
    }
  }
}
