import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
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

/**
 * Power at use, asked from the simulator (round 63, T81). These moves set
 * their power when they land: by weight, HP, speed, status, the held item,
 * happiness or the field. The static asks the move's own handler in the
 * simulator (basePowerCallback, the move's onBasePower, Endeavor's
 * damageCallback) instead of a rule of its own (round 57 parked hand rules
 * on branch r57-power; since round 60 the rules come from the simulator).
 * Only handlers that are pure functions of the board are asked:
 * test/power-handlers-census.spec.ts names every other power handler of the
 * Dex with the reason it stays out (it writes the battle, draws from the
 * PRNG, writes the log, or reads the turn in progress), and checks each
 * class against the simulator:
 *  - memo: the answer reads only what pairKey keys (item, forme, happiness);
 *  - live: it reads HP, status, the field, speed or weight, so landedKey keys
 *    the answer itself.
 */
export const POWER_MOVES: ReadonlyMap<string, 'memo' | 'live'> = new Map([
  ...['knockoff', 'acrobatics', 'return', 'frustration', 'pikapapow', 'veeveevolley', 'watershuriken']
    .map(id => [id, 'memo'] as const),
  ...['lowkick', 'grassknot', 'heavyslam', 'heatcrash', 'flail', 'reversal', 'eruption', 'waterspout', 'dragonenergy',
    'crushgrip', 'wringout', 'hardpress', 'brine', 'gyroball', 'electroball', 'facade', 'hex', 'venoshock',
    'barbbarrage', 'infernalparade', 'wakeupslap', 'smellingsalts', 'solarbeam', 'solarblade', 'expandingforce',
    'psyblade', 'mistyexplosion', 'gravapple', 'collisioncourse', 'electrodrift', 'endeavor']
    .map(id => [id, 'live'] as const),
]);

/** A move's power as the simulator sets it at use; `simDamage` for a fixed-damage move. */
interface PowerAtUse { basePower: number; powerMult: number; simDamage?: number }

type Handler = (this: Battle, ...args: unknown[]) => unknown;

/**
 * One call into the simulator for the static: no debug lines (a custom-game
 * format runs in debug mode, and the sim throws once 1000 unsent lines pile
 * up), and benched bodies read as if on the field (the sim switches off the
 * ability and item of an inactive body from gen 5 on; speed.ts
 * effectiveSpeed does the same for one body).
 */
function onField<T>(battle: Battle, attacker: Pokemon, defender: Pokemon, ask: () => T): T {
  const log = battle as unknown as { debugMode: boolean };
  const debug = log.debugMode;
  const userBenched = !attacker.isActive;
  const targetBenched = !defender.isActive;
  log.debugMode = false;
  attacker.isActive = true;
  defender.isActive = true;
  try {
    return ask();
  } finally {
    if (userBenched) attacker.isActive = false;
    if (targetBenched) defender.isActive = false;
    log.debugMode = debug;
  }
}

/**
 * The move's own onBasePower in the sim's event frame (singleEvent): its
 * chainModify writes the frame's modifier, which the static keeps as powerMult.
 */
function ownBasePower(battle: Battle, attacker: Pokemon, defender: Pokemon, move: ActiveMove, basePower: number): PowerAtUse {
  const own = move.onBasePower as unknown as Handler;
  let modifier = 1;
  const relay: unknown = battle.singleEvent('BasePower', move, null, attacker, defender, move, basePower,
    function (this: Battle, ...args: unknown[]) {
      this.event.modifier = 1;
      const answer = own.apply(this, args);
      modifier = this.event.modifier;
      return answer;
    });
  return { basePower: typeof relay === 'number' ? relay : basePower, powerMult: modifier };
}

/** getDamage's order: fixed damage first, then the power callback, then the move's own BasePower handler. */
function askPower(attacker: Pokemon, defender: Pokemon, move: ActiveMove, battle: Battle): PowerAtUse {
  if (move.damageCallback) {
    const damage: unknown = move.damageCallback.call(battle, attacker, defender);
    return { basePower: 0, powerMult: 1, simDamage: typeof damage === 'number' ? Math.max(0, damage) : 0 };
  }
  const power: unknown = move.basePowerCallback ? move.basePowerCallback.call(battle, attacker, defender, move) : move.basePower;
  // A power of 0 (or false) fails the move; any other is an integer of at least 1.
  if (typeof power !== 'number' || !power) return { basePower: 0, powerMult: 1 };
  const basePower = battle.clampIntRange(power, 1);
  return move.onBasePower ? ownBasePower(battle, attacker, defender, move, basePower) : { basePower, powerMult: 1 };
}

/** A move as the static reads it: the answer at use, or the catalog entry itself when no rule can touch it. */
export type Landed = Pick<MoveAtUse, 'type' | 'category' | 'basePower'> & { powerMult?: number; simDamage?: number };

/** The catalog path allocates nothing: the dex move stands in for its own answer. */
export function landedOrCatalog(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): Landed {
  const asked = POWER_MOVES.has(move.id);
  if (!asked && !RULE_MOVES.has(move.id) && !RULE_ABILITIES.has(String(attacker.ability))) return move;
  const typed: Landed = RULE_MOVES.has(move.id) || RULE_ABILITIES.has(String(attacker.ability))
    ? moveAtUse(move, userFacts(attacker, battle), fieldFacts(attacker, battle)) ?? move
    : move;
  if (!asked) return typed;
  // The Dex move stands in for the active move: the asked handlers only read it (the census spec checks).
  const power = onField(battle, attacker, defender, () => askPower(attacker, defender, move as unknown as ActiveMove, battle));
  return {
    type: typed.type, category: typed.category, basePower: power.basePower,
    powerMult: (typed.powerMult ?? 1) * power.powerMult,
    ...(power.simDamage === undefined ? {} : { simDamage: power.simDamage }),
  };
}

/** A move as it lands for one pair, every field set; `simDamage` for a fixed-damage move asked from the simulator. */
export type LandedAnswer = MoveAtUse & { simDamage?: number };

/** The move as it lands for this pair; the catalog when no rule can touch it. */
export function landedMove(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): LandedAnswer {
  const use = landedOrCatalog(attacker, defender, move, battle);
  return {
    type: use.type, category: use.category, basePower: use.basePower, powerMult: use.powerMult ?? 1,
    ...(use.simDamage === undefined ? {} : { simDamage: use.simDamage }),
  };
}

/**
 * The memo-key term of the move answers (round 57): every usable slot whose
 * answer reads a fact outside pairKey (CONTEXT_MOVES, the live power moves)
 * contributes its answer, so the memo stays a function of its key (round 49)
 * without one key term per fact.
 */
export function landedKey(attacker: Pokemon, defender: Pokemon, slots: readonly { id: string }[], battle: Battle): string {
  let key = '';
  for (const slot of slots) {
    if (!CONTEXT_MOVES.has(slot.id) && POWER_MOVES.get(slot.id) !== 'live') continue;
    const use = landedMove(attacker, defender, battle.dex.moves.get(slot.id), battle);
    key += `|${slot.id}=${use.type}/${use.category}/${use.basePower}/${use.powerMult}/${use.simDamage ?? ''}`;
  }
  return key;
}
