import type { Battle, Pokemon } from '@pkmn/sim';
import { CONTEXT_MOVES, moveAtUse, RULE_ABILITIES, RULE_MOVES, type MoveAtUse, type MoveField, type MoveUser } from '../move-use.ts';

/**
 * The static's side of the move table (round 57): facts from the sim
 * objects, read RAW (ability and item ids, stored stats, fields), the way
 * ABILITY_IMMUNITIES reads them. Suppression (Neutralizing Gas, Gastro Acid,
 * Magic Room, the bench) is ignored on purpose: the static prices benched
 * bodies, and the simulator's own helpers read them as ability- and itemless.
 */
type DexMove = ReturnType<Battle['dex']['moves']['get']>;

const UMBRELLA_WEATHER = new Set(['sunnyday', 'raindance', 'desolateland', 'primordialsea']);
const BOOST_TABLE = [1, 1.5, 2, 2.5, 3, 3.5, 4];

/** getStat(stat, false, true): the stored stat with its stage, no modifiers. */
function staged(pokemon: Pokemon, stat: 'atk' | 'spa' | 'spe'): number {
  const boost = Math.max(-6, Math.min(6, pokemon.boosts[stat]));
  const base = pokemon.storedStats[stat];
  return boost >= 0 ? Math.floor(base * BOOST_TABLE[boost]) : Math.floor(base / BOOST_TABLE[-boost]);
}

/** The types a body is hit and grounded by: the Tera type once clicked (a Stellar Tera keeps the old ones). */
function typesNow(pokemon: Pokemon): readonly string[] {
  const tera = pokemon.terastallized;
  return tera && tera !== 'Stellar' ? [tera] : pokemon.types;
}

/** pokemon.isGrounded() on raw facts (the sim's reads ability and item through the bench suppression). */
function grounded(pokemon: Pokemon, battle: Battle): boolean {
  if ('gravity' in battle.field.pseudoWeather) return true;
  if (('ingrain' in pokemon.volatiles && battle.gen >= 4) || 'smackdown' in pokemon.volatiles) return true;
  if (pokemon.item === 'ironball') return true;
  if (typesNow(pokemon).includes('Flying')) return false;
  if (pokemon.ability === 'levitate') return false;
  if ('magnetrise' in pokemon.volatiles || 'telekinesis' in pokemon.volatiles) return false;
  return pokemon.item !== 'airballoon';
}

export function userFacts(pokemon: Pokemon, battle: Battle): MoveUser {
  const item = pokemon.item ? battle.dex.items.get(pokemon.item) : null;
  return {
    gen: battle.gen,
    species: pokemon.species.name,
    abilities: [String(pokemon.ability)],
    item: item ? { id: item.id, onPlate: item.onPlate, onMemory: item.onMemory, onDrive: item.onDrive, naturalGift: item.naturalGift } : null,
    terastallized: pokemon.terastallized ?? null,
    types: pokemon.types,
    grounded: grounded(pokemon, battle),
    atk: staged(pokemon, 'atk'),
    spa: staged(pokemon, 'spa'),
  };
}

/** The weather the user's moves feel (pokemon.effectiveWeather on raw facts) and the terrain. */
export function fieldFacts(pokemon: Pokemon, battle: Battle): MoveField {
  const weather = battle.field.effectiveWeather();
  return {
    weather: pokemon.item === 'utilityumbrella' && UMBRELLA_WEATHER.has(weather) ? '' : weather,
    terrain: String(battle.field.terrain ?? ''),
  };
}

/** The move as it lands for this pair; the catalog when no rule can touch it. */
export function landedMove(attacker: Pokemon, _defender: Pokemon, move: DexMove, battle: Battle): MoveAtUse {
  const plain: MoveAtUse = { type: move.type, category: move.category, basePower: move.basePower, powerMult: 1 };
  if (!RULE_MOVES.has(move.id) && !RULE_ABILITIES.has(String(attacker.ability))) return plain;
  return moveAtUse(move, userFacts(attacker, battle), fieldFacts(attacker, battle)) ?? plain;
}

/**
 * The memo-key term of the move answers (round 57): every usable slot whose
 * answer reads a fact outside pairKey (CONTEXT_MOVES) contributes its answer,
 * so the memo stays a function of its key (round 49) without one key term
 * per fact.
 */
export function landedKey(attacker: Pokemon, defender: Pokemon, slotIds: readonly string[], battle: Battle): string {
  let key = '';
  for (const id of slotIds) {
    if (!CONTEXT_MOVES.has(id)) continue;
    const use = landedMove(attacker, defender, battle.dex.moves.get(id), battle);
    key += `|${id}=${use.type}/${use.category}/${use.basePower}/${use.powerMult}`;
  }
  return key;
}
