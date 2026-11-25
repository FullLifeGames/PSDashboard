import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { assertSimMods } from './sim-mods.ts';


/** Serializes without the sim's wall-clock `|t:|` log lines, which made identical advances differ across a second. */
export function serializeBattleStable(battle: Battle): string {
  const state = State.serializeBattle(battle) as { log?: string[] };
  if (Array.isArray(state.log)) state.log = state.log.filter(line => !line.startsWith('|t:|'));
  return JSON.stringify(state);
}

/** Exact fidelity: only the moveSlots padding below, no invariant restoration (for harness clone-and-correct paths). */
export function deserializeBattleExact(serialized: string): Battle {
  const state = JSON.parse(serialized) as {
    formatid?: string;
    sides?: { pokemon?: { moveSlots?: unknown[]; baseMoveSlots?: unknown[] }[] }[];
  };
  assertSimMods(state.formatid ?? '');
  // @pkmn/sim's deserializer indexes moveSlots by baseMoveSlots; a transformed mon that copied a partly revealed
  // target has fewer and crashes ("reading 'id'"). Pad a parsed copy, deserialize, trim back: the string stays the key.
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

/** Recomputes `pokemonLeft` (the win-check counter) and `isActive` (drives bench enumeration) from ground truth. */
export function restoreSideInvariants(battle: Battle): void {
  for (const side of battle.sides) {
    side.pokemonLeft = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0).length;
    for (const pokemon of side.pokemon) {
      pokemon.isActive = side.active.includes(pokemon);
    }
  }
}
