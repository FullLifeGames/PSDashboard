import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';

/**
 * Battle serialization for positions: the stable string identity and the
 * two deserializers (exact, and repaired for the search's invariants).
 */

/**
 * Serializes without the sim's wall-clock `|t:|` log lines — they made two
 * identical advances straddling a second boundary serialize differently,
 * breaking position-identity determinism.
 */
export function serializeBattleStable(battle: Battle): string {
  const state = State.serializeBattle(battle) as { log?: string[] };
  if (Array.isArray(state.log)) state.log = state.log.filter(line => !line.startsWith('|t:|'));
  return JSON.stringify(state);
}

/**
 * @pkmn/sim's deserializer walks baseMoveSlots indexing moveSlots to restore
 * slot identity — a transformed mon that copied a PARTIALLY REVEALED target
 * has fewer moveSlots than base, and the walk crashes on the missing tail
 * ("reading 'id'"; Imprison-Transform Mew, gen9doublesou-2660802611). Pad a
 * parsed copy up to base length, deserialize, trim the live arrays back —
 * the battle round-trips exactly and the original string stays the cache key.
 */
/**
 * Exact-fidelity deserialize: ONLY the moveSlots padding workaround above,
 * no invariant restoration — for callers that compare or continue a
 * round-tripped battle against a live one and need the state untouched
 * (the calibration harness's clone-and-correct path).
 */
export function deserializeBattleExact(serialized: string): Battle {
  const state = JSON.parse(serialized) as {
    sides?: { pokemon?: { moveSlots?: unknown[]; baseMoveSlots?: unknown[] }[] }[];
  };
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

export function deserializeRepaired(serialized: string): Battle {
  const battle = deserializeBattleExact(serialized);
  // Correction-era invariant drift (GPL T38/T39): snapshot corrections set
  // hp/fainted per mon without maintaining side.pokemonLeft — the win-check
  // counter, so a wiped side played on behind a stale move request — or
  // isActive, so the bench enumeration offered "switch 1" onto the active.
  // Restore both from ground truth on every deserialize.
  restoreSideInvariants(battle);
  return battle;
}

/**
 * Per-mon corrections change fainted/hp/actives without maintaining the
 * side-level derived state the sim runs on: `pokemonLeft` is the WIN-CHECK
 * counter (drifted high, a wiped side plays on behind a stale move request
 * — GPL T38), and `isActive` drives bench enumeration (drifted false on
 * the active, "switch 1" targeted the field — GPL T39). Recompute both
 * from ground truth after every correction pass and every deserialize.
 */
export function restoreSideInvariants(battle: Battle): void {
  for (const side of battle.sides) {
    side.pokemonLeft = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0).length;
    for (const pokemon of side.pokemon) {
      pokemon.isActive = side.active.includes(pokemon);
    }
  }
}
