import type { Battle, Pokemon } from '@pkmn/sim';
import { moveAtUse, RULE_ABILITIES, RULE_MOVES, type MoveAtUse, type MoveUser } from '../move-use.ts';

/**
 * The static's side of the move table (round 57): facts from the sim
 * objects, read RAW (ability and item ids, stored stats, fields), the way
 * ABILITY_IMMUNITIES reads them. Suppression (Neutralizing Gas, Gastro Acid,
 * Magic Room, the bench) is ignored on purpose: the static prices benched
 * bodies, and the simulator's own helpers read them as ability- and itemless.
 */
type DexMove = ReturnType<Battle['dex']['moves']['get']>;

export function userFacts(pokemon: Pokemon, battle: Battle): MoveUser {
  const item = pokemon.item ? battle.dex.items.get(pokemon.item) : null;
  return {
    gen: battle.gen,
    species: pokemon.species.name,
    abilities: [String(pokemon.ability)],
    item: item ? { id: item.id, onPlate: item.onPlate, onMemory: item.onMemory, onDrive: item.onDrive, naturalGift: item.naturalGift } : null,
    terastallized: pokemon.terastallized ?? null,
    types: pokemon.types,
  };
}

/** The move as it lands for this pair; the catalog when no rule can touch it. */
export function landedMove(attacker: Pokemon, _defender: Pokemon, move: DexMove, battle: Battle): MoveAtUse {
  const plain: MoveAtUse = { type: move.type, category: move.category, basePower: move.basePower, powerMult: 1 };
  if (!RULE_MOVES.has(move.id) && !RULE_ABILITIES.has(String(attacker.ability))) return plain;
  return moveAtUse(move, userFacts(attacker, battle)) ?? plain;
}
