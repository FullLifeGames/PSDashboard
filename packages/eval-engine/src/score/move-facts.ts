import type { ActiveMove, Battle, BoostsTable, ID, Pokemon } from '@pkmn/sim';
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
 *    the answer itself;
 *  - stages: it reads the boost stages, which stay outside the memo key, so
 *    the memo prices it at the power of no boosts and boostedFraction asks
 *    the power on the stages of the moment (stagedPower; decision 3 of the
 *    round-63 wave spec).
 */
export const POWER_MOVES: ReadonlyMap<string, 'memo' | 'live' | 'stages'> = new Map([
  ...['knockoff', 'acrobatics', 'return', 'frustration', 'pikapapow', 'veeveevolley', 'watershuriken']
    .map(id => [id, 'memo'] as const),
  ...['lowkick', 'grassknot', 'heavyslam', 'heatcrash', 'flail', 'reversal', 'eruption', 'waterspout', 'dragonenergy',
    'crushgrip', 'wringout', 'hardpress', 'brine', 'gyroball', 'electroball', 'facade', 'hex', 'venoshock',
    'barbbarrage', 'infernalparade', 'wakeupslap', 'smellingsalts', 'solarbeam', 'solarblade', 'expandingforce',
    'psyblade', 'mistyexplosion', 'gravapple', 'collisioncourse', 'electrodrift', 'endeavor']
    .map(id => [id, 'live'] as const),
  ...['storedpower', 'powertrip', 'punishment'].map(id => [id, 'stages'] as const),
]);

/**
 * Per Dex, read once (round 63, T81 timing): which moves the static resolves
 * at use at all (`touched`: a type rule, a power asked from the simulator,
 * more than one hit or a sure crit), whose answer the memo key carries
 * (`keyed`: the context moves, the live power moves, the sure crits, the
 * moves that split over two foes), which read other stats than their
 * category's (`offAxis`) or set their power from the boosts (`staged`), and
 * the abilities with their own ModifySTAB handler. A set lookup per slot
 * instead of Dex reads per slot.
 */
export interface DexTraits {
  touched: ReadonlySet<string>;
  keyed: ReadonlySet<string>;
  offAxis: ReadonlySet<string>;
  staged: ReadonlySet<string>;
  stabAbilities: ReadonlySet<string>;
}
const dexTraits = new WeakMap<object, DexTraits>();
let lastDex: object | null = null;
let lastTraits: DexTraits | null = null;

function buildTraits(battle: Battle): DexTraits {
  const moves = battle.dex.moves.all();
  const ids = (test: (move: (typeof moves)[number]) => unknown) => new Set(moves.filter(test).map(move => move.id as string));
  const kinds = (kind: string) => [...POWER_MOVES].filter(([, value]) => value === kind).map(([id]) => id);
  return {
    touched: new Set([...POWER_MOVES.keys(), ...RULE_MOVES, ...ids(move => move.multihit || move.willCrit)]),
    keyed: new Set([...CONTEXT_MOVES, ...kinds('live'), ...ids(move => move.willCrit || move.smartTarget)]),
    offAxis: ids(move => move.overrideOffensiveStat || move.overrideDefensiveStat ||
      move.overrideOffensivePokemon || move.overrideDefensivePokemon),
    staged: new Set(kinds('stages')),
    stabAbilities: new Set(battle.dex.abilities.all()
      .filter(ability => (ability as unknown as { onModifySTAB?: unknown }).onModifySTAB).map(ability => ability.id as string)),
  };
}

export function traitsOf(battle: Battle): DexTraits {
  if (battle.dex === lastDex && lastTraits) return lastTraits;
  let traits = dexTraits.get(battle.dex);
  if (!traits) {
    traits = buildTraits(battle);
    dexTraits.set(battle.dex, traits);
  }
  lastDex = battle.dex;
  lastTraits = traits;
  return traits;
}

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

/** askPower on the field (onField) without a closure: the static's hot path asks it for every asked slot. */
function askPowerOnField(attacker: Pokemon, defender: Pokemon, move: ActiveMove, battle: Battle): PowerAtUse {
  const log = battle as unknown as { debugMode: boolean };
  const debug = log.debugMode;
  const userBenched = !attacker.isActive;
  const targetBenched = !defender.isActive;
  log.debugMode = false;
  attacker.isActive = true;
  defender.isActive = true;
  try {
    return askPower(attacker, defender, move, battle);
  } finally {
    if (userBenched) attacker.isActive = false;
    if (targetBenched) defender.isActive = false;
    log.debugMode = debug;
  }
}

/**
 * The move's own onBasePower in an event frame of the sim's shape (what
 * runEvent hands its handlers: the user, the target, the move and a
 * modifier of 1): its chainModify writes the frame's modifier, which the
 * static keeps as powerMult. The frame is set for the call and restored
 * (singleEvent would do the same with more bookkeeping, measured too slow
 * for the static, round 63).
 */
function ownBasePower(battle: Battle, attacker: Pokemon, defender: Pokemon, move: ActiveMove, basePower: number): PowerAtUse {
  const own = move.onBasePower as unknown as Handler;
  const frame = battle as unknown as { event: unknown };
  const parent = frame.event;
  const event = { id: 'BasePower', target: attacker, source: defender, effect: move, modifier: 1 };
  frame.event = event;
  let relay: unknown;
  try {
    relay = own.call(battle, basePower, attacker, defender, move);
  } finally {
    frame.event = parent;
  }
  return { basePower: typeof relay === 'number' ? relay : basePower, powerMult: event.modifier };
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

const skillLink = (attacker: Pokemon) => String(attacker.ability) === 'skilllink';
const loadedDice = (attacker: Pokemon) => attacker.item === 'loadeddice';

/**
 * The expected hit count of the simulator's hit loop (battle-actions.js
 * hitStepMoveHitLoop). Its rules live inline there, with no handler to ask,
 * so they are mirrored here and test/multi-hit.spec.ts holds them against
 * the simulator (the array it samples, its counts per turn): 2 to 5 hits are
 * 2/2/2/2/2/2/2/3/3/3/3/3/3/3/4/4/4/5/5/5 from gen 5 on (mean 3.1) and
 * 2/2/2/3/3/3/4/5 before (3.0); Skill Link takes the top count; Loaded Dice
 * turns a count under 4 into 4 or 5 (mean 4.5) and ten hits into 4 to 10 (7).
 */
function expectedHits(attacker: Pokemon, multihit: number | number[], gen: number): number {
  if (typeof multihit === 'number') return multihit === 10 && loadedDice(attacker) ? 7 : multihit;
  const [low, high] = multihit;
  if (skillLink(attacker)) return high;
  if (low === 2 && high === 5) return gen >= 5 ? (loadedDice(attacker) ? 4.5 : 3.1) : 3;
  return (low + high) / 2;
}

/**
 * Every hit of a multi-hit move as one factor on the damage. A move whose
 * callback reads the hit number (Triple Axel) is asked per hit; a per-hit
 * accuracy roll (multiaccuracy, cleared by Skill Link and Loaded Dice) ends
 * the chain at the first miss, so hit k counts at accuracy^(k-1); Dragon
 * Darts in doubles splits its two hits over two living foes (smartTarget).
 */
function hitsFactor(attacker: Pokemon, defender: Pokemon, move: DexMove, basePower: number, battle: Battle): number {
  const multihit = move.multihit;
  if (!multihit) return 1;
  if (move.smartTarget && battle.gameType === 'doubles' &&
    defender.side.active.some(ally => ally && ally !== defender && !ally.fainted && ally.hp > 0)) return 1;
  const hits = expectedHits(attacker, multihit, battle.gen);
  const chained = !!move.multiaccuracy && !skillLink(attacker) && !loadedDice(attacker);
  const perHit = move.basePowerCallback && !POWER_MOVES.has(move.id) ? move.basePowerCallback as unknown as Handler : null;
  if (!chained && !perHit) return hits;
  const accuracy = chained && move.accuracy !== true ? move.accuracy / 100 : 1;
  const powerOf = (hit: number) =>
    (perHit ? Number(perHit.call(battle, attacker, defender, Object.create(move, { hit: { value: hit } }))) : basePower);
  return basePower ? chainedPower(hits, accuracy, powerOf) / basePower : 0;
}

/** The power of a hit chain: hit k at its own power, reached at accuracy^(k-1). */
function chainedPower(hits: number, accuracy: number, powerOf: (hit: number) => number): number {
  let total = 0;
  for (let hit = 1; hit <= hits; hit++) total += powerOf(hit) * accuracy ** (hit - 1);
  return total;
}

/**
 * A sure crit (willCrit) lands its crit unless the target blocks it (the
 * sim's CriticalHit event: Battle Armor, Shell Armor, Lucky Chant); the
 * multiplier is modifyDamage's: the move's critModifier, else 1.5 from gen 6
 * on and 2 before.
 */
function critFactor(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): number {
  if (!move.willCrit) return 1;
  const lands: unknown = onField(battle, attacker, defender, () => battle.runEvent('CriticalHit', defender, null, move as unknown as ActiveMove));
  return lands ? move.critModifier || (battle.gen >= 6 ? 1.5 : 2) : 1;
}

/** A move as the static reads it: the answer at use, or the catalog entry itself when no rule can touch it. */
export type Landed = Pick<MoveAtUse, 'type' | 'category' | 'basePower'> & {
  powerMult?: number;
  /** Fixed damage the simulator deals (Endeavor). */
  simDamage?: number;
  /** Every hit and a sure crit, on the whole damage (each hit carries its own +2, a crit multiplies it). */
  landing?: number;
};

/** The catalog path allocates nothing: the dex move stands in for its own answer. */
export function landedOrCatalog(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): Landed {
  const retypedByAbility = RULE_ABILITIES.has(String(attacker.ability));
  if (!retypedByAbility && !traitsOf(battle).touched.has(move.id)) return move;
  const typed: Landed = retypedByAbility || RULE_MOVES.has(move.id)
    ? moveAtUse(move, userFacts(attacker, battle), fieldFacts(attacker, battle)) ?? move
    : move;
  return landedPower(attacker, defender, move, battle, typed);
}

/** The power at use on top of the typed answer: asked from the simulator, every hit, a sure crit. */
function landedPower(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle, typed: Landed): Landed {
  // The Dex move stands in for the active move: the asked handlers only read it (the census spec checks).
  const power = POWER_MOVES.has(move.id) ? askPowerOnField(attacker, defender, move as unknown as ActiveMove, battle) : null;
  const basePower = power ? power.basePower : typed.basePower;
  const landing = move.multihit || move.willCrit
    ? hitsFactor(attacker, defender, move, basePower, battle) * critFactor(attacker, defender, move, battle)
    : 1;
  if (!power && landing === 1) return typed;
  const answer: Landed = {
    type: typed.type, category: typed.category, basePower, powerMult: (typed.powerMult ?? 1) * (power ? power.powerMult : 1),
  };
  if (power?.simDamage !== undefined) answer.simDamage = power.simDamage;
  if (landing !== 1) answer.landing = landing;
  return answer;
}

/**
 * The attacker's own ModifySTAB handler (Adaptability), found by its Dex
 * field and asked in the sim's event frame on the STAB the rules give.
 */
export function abilityStab(attacker: Pokemon, defender: Pokemon, move: DexMove, stab: number, battle: Battle): number {
  if (!traitsOf(battle).stabAbilities.has(attacker.ability)) return stab;
  const ability = battle.dex.abilities.getByID(attacker.ability);
  const answer: unknown = onField(battle, attacker, defender, () =>
    battle.singleEvent('ModifySTAB', ability, attacker.abilityState, attacker, defender, move as unknown as ActiveMove, stab));
  return typeof answer === 'number' ? answer : stab;
}

const NO_BOOSTS: BoostsTable = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };

/** A view of one body on other stages; every other read goes to the body itself. */
const onStages = (pokemon: Pokemon, boosts: BoostsTable): Pokemon =>
  Object.create(pokemon, { boosts: { value: boosts } }) as Pokemon;

/** A stages-class move as the memo prices it: both bodies on no boosts. */
export function stagedLanded(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): Landed {
  return landedOrCatalog(onStages(attacker, NO_BOOSTS), onStages(defender, NO_BOOSTS), move, battle);
}

/** The power the simulator gives a stages-class move on the live stages, the attacker's overridden where asked. */
export function stagedPower(attacker: Pokemon, defender: Pokemon, moveId: string, boosts?: Partial<BoostsTable>): number {
  const battle = attacker.battle;
  const user = boosts ? onStages(attacker, { ...attacker.boosts, ...boosts }) : attacker;
  const move = battle.dex.moves.get(moveId) as unknown as ActiveMove;
  return askPowerOnField(user, defender, move, battle).basePower;
}

/** A move as it lands for one pair, every field set; `simDamage` and `landing` as in Landed. */
export type LandedAnswer = MoveAtUse & { simDamage?: number; landing?: number };

/** The move as it lands for this pair; the catalog when no rule can touch it. */
export function landedMove(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): LandedAnswer {
  const use = landedOrCatalog(attacker, defender, move, battle);
  return {
    type: use.type, category: use.category, basePower: use.basePower, powerMult: use.powerMult ?? 1,
    ...(use.simDamage === undefined ? {} : { simDamage: use.simDamage }),
    ...(use.landing === undefined ? {} : { landing: use.landing }),
  };
}

/**
 * The answers the memo key carries (round 57): every usable slot whose
 * answer reads a fact outside pairKey (CONTEXT_MOVES, the live power moves,
 * a sure crit against Lucky Chant, Dragon Darts against the foe's partner),
 * by slot id; null when no slot needs one, as for most pairs. On a miss the
 * memo prices the pair with these same answers (round 63: asked once).
 */
export function keyedAnswers(attacker: Pokemon, defender: Pokemon, slots: readonly { id: string }[], battle: Battle): Map<string, Landed> | null {
  const { keyed } = traitsOf(battle);
  let answers: Map<string, Landed> | null = null;
  for (const slot of slots) {
    if (!keyed.has(slot.id)) continue;
    (answers ??= new Map()).set(slot.id, landedOrCatalog(attacker, defender, battle.dex.moves.getByID(slot.id as ID), battle));
  }
  return answers;
}

/** The memo-key term of the keyed answers, so the memo stays a function of its key (round 49) without one key term per fact. */
export function landedKey(answers: ReadonlyMap<string, Landed> | null): string {
  if (!answers) return '';
  let key = '';
  for (const [id, use] of answers) {
    key += `|${id}=${use.type}/${use.category}/${use.basePower}/${use.powerMult ?? 1}/${use.simDamage ?? ''}/${use.landing ?? ''}`;
  }
  return key;
}
