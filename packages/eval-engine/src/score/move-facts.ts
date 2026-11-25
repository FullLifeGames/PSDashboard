import type { ActiveMove, Battle, BoostsTable, ID, Pokemon } from '@pkmn/sim';
import { umbrellaWeathers } from '@fulllifegames/replay-core';
import { hitDraws } from '../calc/hit-draws.ts';
import { CONTEXT_MOVES, moveAtUse, RULE_ABILITIES, RULE_MOVES, type ItemLike, type MoveAtUse, type MoveField, type MoveUser } from '../move-use.ts';

// Facts are read raw from the sim objects: suppression (Neutralizing Gas, Gastro Acid, Magic Room, bench) is ignored,
// because the static prices benched bodies, which the simulator's helpers read as ability- and itemless.
type DexMove = ReturnType<Battle['dex']['moves']['get']>;

const BOOST_TABLE = [1, 1.5, 2, 2.5, 3, 3.5, 4];

function staged(pokemon: Pokemon, stat: 'atk' | 'spa' | 'spe'): number {
  const boost = Math.max(-6, Math.min(6, pokemon.boosts[stat]));
  const base = pokemon.storedStats[stat];
  return boost >= 0 ? Math.floor(base * BOOST_TABLE[boost]) : Math.floor(base / BOOST_TABLE[-boost]);
}

// The types a body is hit and grounded by: the Tera type once clicked (a Stellar Tera keeps the old ones).
function typesNow(pokemon: Pokemon): readonly string[] {
  const tera = pokemon.terastallized;
  return tera && tera !== 'Stellar' ? [tera] : pokemon.types;
}

function grounded(pokemon: Pokemon, battle: Battle): boolean {
  if ('gravity' in battle.field.pseudoWeather) return true;
  if (('ingrain' in pokemon.volatiles && battle.gen >= 4) || 'smackdown' in pokemon.volatiles) return true;
  if (pokemon.item === 'ironball') return true;
  if (typesNow(pokemon).includes('Flying')) return false;
  if (pokemon.ability === 'levitate') return false;
  if ('magnetrise' in pokemon.volatiles || 'telekinesis' in pokemon.volatiles) return false;
  return pokemon.item !== 'airballoon';
}

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

export function fieldFacts(pokemon: Pokemon, battle: Battle): MoveField {
  return {
    get weather() {
      const weather = battle.field.effectiveWeather();
      return pokemon.item === 'utilityumbrella' && umbrellaWeathers(battle.dex).has(weather) ? '' : weather;
    },
    terrain: String(battle.field.terrain ?? ''),
  };
}

/** Power-at-use moves by key class: memo (pairKey), live (landedKey), stages (unboosted, then live). */
// oracle: packages/eval-engine/test/power-handlers-census.spec.ts
export const POWER_MOVES: ReadonlyMap<string, 'memo' | 'live' | 'stages'> = new Map([
  ...['knockoff', 'acrobatics', 'return', 'frustration', 'pikapapow', 'veeveevolley', 'watershuriken']
    .map(id => [id, 'memo'] as const),
  ...['lowkick', 'grassknot', 'heavyslam', 'heatcrash', 'flail', 'reversal', 'eruption', 'waterspout', 'dragonenergy',
    'crushgrip', 'wringout', 'hardpress', 'brine', 'gyroball', 'electroball', 'facade', 'hex', 'venoshock',
    'barbbarrage', 'infernalparade', 'wakeupslap', 'smellingsalts', 'solarbeam', 'solarblade', 'expandingforce',
    'psyblade', 'mistyexplosion', 'gravapple', 'collisioncourse', 'electrodrift', 'endeavor',
    // eslint-disable-next-line names/no-new-dex-name -- held by history-power-sweep.spec.ts: every Dex move that historyPower reads is priced by the callback
    'lastrespects', 'ragefist']
    .map(id => [id, 'live'] as const),
  ...['storedpower', 'powertrip', 'punishment'].map(id => [id, 'stages'] as const),
]);

/** Per Dex, read once: moves resolved at use (`touched`), moves the memo key carries (`keyed`), off-axis, staged. */
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

interface PowerAtUse { basePower: number; powerMult: number; simDamage?: number }

type Handler = (this: Battle, ...args: unknown[]) => unknown;

// No debug lines: a custom-game format runs in debug mode and the sim throws once 1000 unsent lines pile up.
// Benched bodies read as on the field: the sim switches off an inactive body's ability and item from gen 5 on.
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

// An event frame of the sim's shape: chainModify writes the frame's modifier, which becomes powerMult.
// The frame is restored after the call (singleEvent does the same, too slow here).
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

// getDamage's order: fixed damage first, then the power callback, then the move's own BasePower handler.
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

// The mean of the sim's sampled hit array (calc/hit-draws.ts): 3.1 for 2 to 5 hits from gen 5 on, 3 before,
// 4.5 and 7 under Loaded Dice; Skill Link takes the top count.
function expectedHits(attacker: Pokemon, multihit: number | number[], gen: number): number {
  const drawn = hitDraws(gen, Array.isArray(multihit) && skillLink(attacker) ? multihit[1] : multihit, loadedDice(attacker));
  return drawn.reduce((sum, hits) => sum + hits, 0) / drawn.length;
}

// A callback that reads the hit number (Triple Axel) is asked per hit; a per-hit accuracy roll (multiaccuracy) ends
// it at the first miss, so hit k counts at accuracy^(k-1); Dragon Darts in doubles splits its two hits over two foes.
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

function chainedPower(hits: number, accuracy: number, powerOf: (hit: number) => number): number {
  let total = 0;
  for (let hit = 1; hit <= hits; hit++) total += powerOf(hit) * accuracy ** (hit - 1);
  return total;
}

// A sure crit lands unless the target blocks it (CriticalHit event: Battle Armor, Shell Armor, Lucky Chant);
// the multiplier is the move's critModifier, else 1.5 from gen 6 on and 2 before.
function critFactor(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): number {
  if (!move.willCrit) return 1;
  const lands: unknown = onField(battle, attacker, defender, () => battle.runEvent('CriticalHit', defender, null, move as unknown as ActiveMove));
  return lands ? move.critModifier || (battle.gen >= 6 ? 1.5 : 2) : 1;
}

export type Landed = Pick<MoveAtUse, 'type' | 'category' | 'basePower'> & {
  powerMult?: number;
  simDamage?: number;
  /** Every hit and a sure crit, on the whole damage (each hit carries its own +2, a crit multiplies it). */
  landing?: number;
};

export function landedOrCatalog(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): Landed {
  const retypedByAbility = RULE_ABILITIES.has(String(attacker.ability));
  if (!retypedByAbility && !traitsOf(battle).touched.has(move.id)) return move;
  const typed: Landed = retypedByAbility || RULE_MOVES.has(move.id)
    ? moveAtUse(move, userFacts(attacker, battle), fieldFacts(attacker, battle)) ?? move
    : move;
  return landedPower(attacker, defender, move, battle, typed);
}

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

export function abilityStab(attacker: Pokemon, defender: Pokemon, move: DexMove, stab: number, battle: Battle): number {
  if (!traitsOf(battle).stabAbilities.has(attacker.ability)) return stab;
  const ability = battle.dex.abilities.getByID(attacker.ability);
  const answer: unknown = onField(battle, attacker, defender, () =>
    battle.singleEvent('ModifySTAB', ability, attacker.abilityState, attacker, defender, move as unknown as ActiveMove, stab));
  return typeof answer === 'number' ? answer : stab;
}

const NO_BOOSTS: BoostsTable = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };

const onStages = (pokemon: Pokemon, boosts: BoostsTable): Pokemon =>
  Object.create(pokemon, { boosts: { value: boosts } }) as Pokemon;

export function stagedLanded(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): Landed {
  return landedOrCatalog(onStages(attacker, NO_BOOSTS), onStages(defender, NO_BOOSTS), move, battle);
}

export function stagedPower(attacker: Pokemon, defender: Pokemon, moveId: string, boosts?: Partial<BoostsTable>): number {
  const battle = attacker.battle;
  const user = boosts ? onStages(attacker, { ...attacker.boosts, ...boosts }) : attacker;
  const move = battle.dex.moves.get(moveId) as unknown as ActiveMove;
  return askPowerOnField(user, defender, move, battle).basePower;
}

export type LandedAnswer = MoveAtUse & { simDamage?: number; landing?: number };

export function landedMove(attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle): LandedAnswer {
  const use = landedOrCatalog(attacker, defender, move, battle);
  return {
    type: use.type, category: use.category, basePower: use.basePower, powerMult: use.powerMult ?? 1,
    ...(use.simDamage === undefined ? {} : { simDamage: use.simDamage }),
    ...(use.landing === undefined ? {} : { landing: use.landing }),
  };
}

/** The answers the memo key carries, by slot id; null when no slot needs one, as for most pairs. */
export function keyedAnswers(attacker: Pokemon, defender: Pokemon, slots: readonly { id: string }[], battle: Battle): Map<string, Landed> | null {
  const { keyed } = traitsOf(battle);
  let answers: Map<string, Landed> | null = null;
  for (const slot of slots) {
    if (!keyed.has(slot.id)) continue;
    (answers ??= new Map()).set(slot.id, landedOrCatalog(attacker, defender, battle.dex.moves.getByID(slot.id as ID), battle));
  }
  return answers;
}

export function landedKey(answers: ReadonlyMap<string, Landed> | null): string {
  if (!answers) return '';
  let key = '';
  for (const [id, use] of answers) {
    key += `|${id}=${use.type}/${use.category}/${use.basePower}/${use.powerMult ?? 1}/${use.simDamage ?? ''}/${use.landing ?? ''}`;
  }
  return key;
}
