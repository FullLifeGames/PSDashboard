import type { Battle, Pokemon } from '@pkmn/sim';
import { CONTEXT_MOVES, moveAtUse, RULE_ABILITIES, RULE_MOVES, type ItemLike, type MoveAtUse, type MoveField, type MoveUser } from '../move-use.ts';

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

/**
 * The user's facts, computed when a rule reads them (round 57, timing): most
 * rules read one or two facts, and a cold static prices every living pair.
 */
class UserFacts implements MoveUser {
  readonly gen: number;
  readonly species: string;
  readonly abilities: readonly string[];
  readonly terastallized: string | null;
  readonly types: readonly string[];
  private readonly pokemon: Pokemon;
  private readonly battle: Battle;

  constructor(pokemon: Pokemon, battle: Battle) {
    this.pokemon = pokemon;
    this.battle = battle;
    this.gen = battle.gen;
    this.species = pokemon.species.name;
    this.abilities = [String(pokemon.ability)];
    this.terastallized = pokemon.terastallized ?? null;
    this.types = pokemon.types;
  }

  get item(): ItemLike | null {
    if (!this.pokemon.item) return null;
    const item = this.battle.dex.items.get(this.pokemon.item);
    return { id: item.id, onPlate: item.onPlate, onMemory: item.onMemory, onDrive: item.onDrive, naturalGift: item.naturalGift };
  }

  get grounded(): boolean { return grounded(this.pokemon, this.battle); }
  get atk(): number { return staged(this.pokemon, 'atk'); }
  get spa(): number { return staged(this.pokemon, 'spa'); }
  get hpType(): string { return this.pokemon.hpType || 'Dark'; }
  get hpPower(): number { return this.pokemon.hpPower; }
}

export function userFacts(pokemon: Pokemon, battle: Battle): MoveUser {
  return new UserFacts(pokemon, battle);
}

/** The weather the user's moves feel (pokemon.effectiveWeather on raw facts), read when a rule asks, and the terrain. */
export function fieldFacts(pokemon: Pokemon, battle: Battle): MoveField {
  return {
    get weather() {
      const weather = battle.field.effectiveWeather();
      return pokemon.item === 'utilityumbrella' && UMBRELLA_WEATHER.has(weather) ? '' : weather;
    },
    terrain: String(battle.field.terrain ?? ''),
  };
}

/** A move as the static reads it: the answer at use, or the catalog entry itself when no rule can touch it. */
export type Landed = Pick<MoveAtUse, 'type' | 'category' | 'basePower'> & { powerMult?: number };

/** The catalog path allocates nothing: the dex move stands in for its own answer. */
export function landedOrCatalog(attacker: Pokemon, _defender: Pokemon, move: DexMove, battle: Battle): Landed {
  if (!RULE_MOVES.has(move.id) && !RULE_ABILITIES.has(String(attacker.ability))) return move;
  return moveAtUse(move, userFacts(attacker, battle), fieldFacts(attacker, battle)) ?? move;
}

/** The move as it lands for this pair; the catalog when no rule can touch it. */
export function landedMove(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): MoveAtUse {
  const use = landedOrCatalog(attacker, defender, move, battle);
  return { type: use.type, category: use.category, basePower: use.basePower, powerMult: use.powerMult ?? 1 };
}

/**
 * The memo-key term of the move answers (round 57): every usable slot whose
 * answer reads a fact outside pairKey (CONTEXT_MOVES) contributes its answer,
 * so the memo stays a function of its key (round 49) without one key term
 * per fact.
 */
export function landedKey(attacker: Pokemon, defender: Pokemon, slots: readonly { id: string }[], battle: Battle): string {
  let key = '';
  for (const slot of slots) {
    if (!CONTEXT_MOVES.has(slot.id)) continue;
    const use = landedMove(attacker, defender, battle.dex.moves.get(slot.id), battle);
    key += `|${slot.id}=${use.type}/${use.category}/${use.basePower}/${use.powerMult}`;
  }
  return key;
}
