import type { Battle, BoostsTable, Pokemon, Side, StatIDExceptHP } from '@pkmn/sim';
import { stageMultiplier } from '../stat-stages.ts';
import { abilityStab, landedKey, landedOrCatalog, POWER_MOVES, stagedLanded, stagedPower, type Landed } from './move-facts.ts';

/**
 * The HP- and boost-independent threat proxy: one attacker→defender
 * direction's best expected move fractions, memoized per search, with the
 * live boost stages applied on read.
 */

/** Living mons of one side (fainted or zero-HP bodies excluded). */
export const livingOf = (side: Side): Pokemon[] =>
  side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
export const livingMons = (battle: Battle, index: number): Pokemon[] => livingOf(battle.sides[index]);

/** HP- and boost-independent threat estimate of one attacker→defender direction. */
export interface PairThreat {
  /** Best expected physical-move damage as a fraction of the defender's max HP. */
  physical: number;
  /** Best expected special-move damage as a fraction of the defender's max HP. */
  special: number;
  /** The attacker carries a usable damaging priority move. */
  priority: boolean;
  /**
   * Accuracy (0–1, 1 = never misses) of the category-max move (round 14).
   * The narrative race weighs its rates by these — a 70% Hurricane is no
   * full-hit clock (648453 t13) — while the SCORE path never reads them:
   * matchup and coverage stay on the raw fractions. Optional so hand-built
   * threats in tests keep working; consumers default to 1.
   */
  physicalAcc?: number;
  specialAcc?: number;
  /**
   * Moves whose stages are not their category's (round 63, T81), each with
   * its own best fraction at stage 0: Body Press (the user's Defense),
   * Psyshock (the target's Defense), Foul Play (the target's Attack), and
   * the moves whose power the boosts set (Stored Power, Power Trip), priced
   * at the power of no boosts. Absent on an ordinary pair.
   */
  axes?: AxisThreat[];
}

/** One move whose damage reads other stages than its category's (PairThreat.axes). */
export interface AxisThreat {
  fraction: number;
  acc: number;
  /** Whose offensive stage the damage reads, and which. */
  holder: 'attacker' | 'defender';
  offense: StatIDExceptHP;
  /** The target's defensive stage the damage reads. */
  defense: StatIDExceptHP;
  /** A move whose power the boosts set: its id and the power its fraction was priced at. */
  staged?: { id: string; basePower: number };
}

/**
 * Memo for the boost-independent part of the matchup term. One cache spans
 * one search. The memo MUST be a function of its key: the app splits one
 * matrix over a worker pool with one cache per worker, so a value that
 * depends on what a cache saw first differs run to run (round 49: two runs
 * of one doubles replay disagreed on single cells). Most of what pairThreat
 * reads is constant across the forked positions of one battle, but not all
 * of it, so pairKey carries EVERY read of the memoized function: level, item,
 * ability, choice lock and usable slots, the current types (Protean, Soak,
 * Burn Up), the Tera type, the stored stats it divides (Power Trick, Guard Split), the
 * defender's max HP (forme change, Dynamax) and, where a halving move prices
 * off it, the defender's current HP. A new read inside pairThreat or
 * singleMoveFraction needs its key term (test/threat-memo.spec.ts). Round 57:
 * a move whose answer at use reads a fact the key does not name (weather,
 * terrain, grounding, stages, Hidden Power) keys its answer instead
 * (landedKey, CONTEXT_MOVES in move-use.ts); round 63 (T81) adds the moves
 * whose power the simulator sets from HP, status, the field, speed or weight
 * (the live class of POWER_MOVES in move-facts.ts).
 */
export type MatchupCache = Map<string, PairThreat>;

export function createMatchupCache(): MatchupCache {
  return new Map();
}

/** The move a Choice item has locked this Pokémon into, if any. */
function lockedMoveId(pokemon: Pokemon): string | null {
  const locked = pokemon.volatiles['choicelock'] as { move?: string } | undefined;
  return locked?.move ?? null;
}

/**
 * Move slots with PP left to click. PP is read LIVE from the sim state and
 * never derived from dex base PP: pools differ across rule sets (Showdown
 * effectively always runs maxed PP Ups; Pokémon Champions runs different
 * counts), and the replay's PP bookkeeping is the only ground truth. A slot
 * without a pp field stays usable (defensive default). A fully drained mon
 * can still Struggle in reality, but its chip is no sustained threat — it
 * prices as threatless (573756: the Struggle-locked Toxapex kept pricing as
 * a full wall while it recoiled itself out).
 */
export function usableSlots(pokemon: Pokemon): Pokemon['moveSlots'] {
  return pokemon.moveSlots.filter(slot => (slot.pp ?? 1) > 0);
}

/** Moves that deal half the target's CURRENT HP. */
const HALVING_MOVES: ReadonlySet<string> = new Set(['superfang', 'naturesmadness', 'ruination']);

function pairKey(attacker: Pokemon, defender: Pokemon, battle: Battle): string {
  // The usable-slot signature keys PP transitions: a move draining to zero
  // mid-search changes the attacker's threat, so it must miss the memo.
  const slots = usableSlots(attacker);
  const usable = slots.map(slot => slot.id).join(',');
  // A halving move prices off the defender's current HP, so such a pair keys
  // on it. Without it the first forked position to ask froze its HP into the
  // memo for the whole search, and in the app, where a worker pool splits
  // one matrix, the value of a cell followed which worker priced it (round 49).
  const liveHp = slots.some(slot => HALVING_MOVES.has(slot.id)) ? `:${defender.hp}` : '';
  // Types and the stored stats are constant for nearly every pair and move
  // under Protean, Soak, Power Trick and their kin; the key carries them so
  // the memo never answers for a body that has changed since it was asked.
  // A Tera click leaves `types` alone and sets `terastallized`, so the key
  // carries both. The defender's term mirrors a read (liveTypes); a Stellar
  // body keeps its old types for defense, so the raw types stay. The
  // attacker's term mirrors STAB by the rules (round 63, T81), a Stellar
  // body's term the types it has spent its boost on.
  const stellar = attacker.terastallized === 'Stellar' ? `:${attacker.stellarBoostedTypes.join('/')}` : '';
  const offense = `${attacker.types.join('/')}:${attacker.terastallized ?? ''}${stellar}:${attacker.storedStats.atk}:${attacker.storedStats.spa}`;
  const defense = `${defender.types.join('/')}:${defender.terastallized ?? ''}:${defender.storedStats.def}:${defender.storedStats.spd}:${defender.maxhp}`;
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}:${usable}:${offense}>` +
    `${defender.side.id}:${defender.name}:${defender.species.id}:${defender.level}:${defender.item}:${defender.ability}:${defense}${liveHp}` +
    landedKey(attacker, defender, slots, battle);
}

/**
 * The types a body defends with. After a Tera click the sim keeps `types` at
 * the old types and carries the new one in `terastallized`; a Stellar Tera
 * keeps the old types for defense. Not `getTypes()` on purpose: that adds
 * Roost and the added types (Forest's Curse, Trick-or-Treat), and round 54
 * measured Tera alone. The shortcut is still exact at a turn boundary: the
 * click clears an added type, and Roost does not outlast its turn.
 */
export function liveTypes(pokemon: Pokemon): string[] {
  const tera = pokemon.terastallized;
  return tera && tera !== 'Stellar' ? [tera] : pokemon.types;
}

/** Defender abilities that blank (or halve) incoming move types in the proxy. */
const ABILITY_IMMUNITIES: Record<string, string[]> = {
  levitate: ['Ground'],
  flashfire: ['Fire'],
  wellbakedbody: ['Fire'],
  waterabsorb: ['Water'],
  dryskin: ['Water'],
  stormdrain: ['Water'],
  voltabsorb: ['Electric'],
  lightningrod: ['Electric'],
  motordrive: ['Electric'],
  sapsipper: ['Grass'],
  eartheater: ['Ground'],
};

/**
 * Defender abilities that blank a move FLAG instead of a type (round 54,
 * gen9doublesou-2660822493 t2: Hurricane into a Wind Rider Shiftry priced
 * 277 % of its HP where the damage calc reads 0).
 */
const ABILITY_FLAG_IMMUNITIES: Record<string, 'wind' | 'sound' | 'bullet'> = {
  windrider: 'wind',
  soundproof: 'sound',
  bulletproof: 'bullet',
};

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

/** The attacker's big damage modifiers: Life Orb, the matching Choice item, Thick Fat on the defender. */
function offenseMultiplier(attacker: Pokemon, defender: Pokemon, use: Landed): number {
  let offense = 1;
  if (attacker.item === 'lifeorb') offense *= 1.3;
  if (attacker.item === 'choiceband' && use.category === 'Physical') offense *= 1.5;
  if (attacker.item === 'choicespecs' && use.category === 'Special') offense *= 1.5;
  if (defender.ability === 'thickfat' && (use.type === 'Fire' || use.type === 'Ice')) offense *= 0.5;
  return offense;
}

/**
 * The defender's bulk items: Eviolite on an NFE, Assault Vest on Special
 * Defense. The sim modifies the defensive stat the move reads (getDamage:
 * Modify<Def|SpD> of defenseStat), so Psyshock passes an Assault Vest; the
 * offensive modifiers above follow the category, as getDamage's do.
 */
function bulkMultiplier(defender: Pokemon, defense: StatIDExceptHP): number {
  let bulk = 1;
  if (defender.item === 'eviolite' && defender.species.nfe) bulk *= 1.5;
  if (defender.item === 'assaultvest' && defense === 'spd') bulk *= 1.5;
  return bulk;
}

/** A move whose Dex entry names the stats its damage reads (Body Press, Psyshock, Foul Play). */
const offAxis = (move: DexMove) =>
  !!(move.overrideOffensiveStat || move.overrideDefensiveStat || move.overrideOffensivePokemon || move.overrideDefensivePokemon);

/**
 * Fixed damage the proxy can price without a base power (round 33: the
 * last-pair race must see a Seismic Toss Chansey as an attacker). Level
 * moves deal the user's level, the halving moves half the target's
 * current HP; the reactive family (Counter, Mirror Coat, Metal Burst) and
 * self-sacrifice stay at 0. Endeavor's HP difference comes from the
 * simulator (landedOrCatalog, round 63).
 */
function fixedDamage(move: DexMove, attacker: Pokemon, defender: Pokemon): number {
  if (HALVING_MOVES.has(move.id)) return Math.floor(defender.hp / 2);
  switch (move.id) {
    case 'seismictoss':
    case 'nightshade':
    case 'psywave':
      return attacker.level;
    case 'dragonrage':
      return 40;
    case 'sonicboom':
      return 20;
    default:
      return 0;
  }
}

/** Scrappy and Mind's Eye let Normal and Fighting moves hit Ghosts (the sim's ignoreImmunity). */
function ignoresImmunity(attacker: Pokemon, type: string): boolean {
  return (attacker.ability === 'scrappy' || attacker.ability === 'mindseye') && (type === 'Normal' || type === 'Fighting');
}

/**
 * Expected damage of one specific move as a fraction of the defender's max
 * HP under the proxy's rules — standard damage formula with STAB, the type
 * chart, and the big item/ability modifiers; fixed-damage moves at their
 * fixed amount; 0 for status, reactive, and immune moves. The type, category
 * and power are the move's at use (move-use.ts, round 57; the power the
 * simulator sets at use, move-facts.ts, round 63).
 */
export function singleMoveFraction(attacker: Pokemon, defender: Pokemon, moveId: string, battle: Battle): number {
  const move = battle.dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status') return 0;
  // The move as it lands (round 57): its type, category and power at use.
  return landedFraction(attacker, defender, move, landedOrCatalog(attacker, defender, move, battle), battle);
}

/** The defender's ability or types blank the move (the proxy's immunities). */
function blanked(attacker: Pokemon, defender: Pokemon, move: DexMove, type: string, defenderTypes: string[], battle: Battle): boolean {
  if ((ABILITY_IMMUNITIES[defender.ability] ?? []).includes(type)) return true;
  const blankedFlag = ABILITY_FLAG_IMMUNITIES[defender.ability];
  if (blankedFlag && move.flags[blankedFlag]) return true;
  return !ignoresImmunity(attacker, type) && !battle.dex.getImmunity(type, defenderTypes);
}

/** The stats getDamage reads: the Dex entry's override, else the category's own (round 63, T81). */
const offenseStat = (move: DexMove, physical: boolean): StatIDExceptHP => move.overrideOffensiveStat ?? (physical ? 'atk' : 'spa');
const defenseStat = (move: DexMove, physical: boolean): StatIDExceptHP => move.overrideDefensiveStat ?? (physical ? 'def' : 'spd');

/**
 * STAB by the game's rules (BattleActions#modifyDamage; T71, built in round
 * 54 and landed with T81 in round 63): an old type or the Tera type 1.5, an
 * old type that is also the Tera type 2.0; a Stellar Tera 2.0 on an old
 * type and 1.2 elsewhere, on the first use of a type only (the sim's
 * stellarBoostedTypes, which Terapagos-Stellar never fills); then the
 * attacker's own ModifySTAB handler (Adaptability), asked from the
 * simulator. modifyDamage writes the battle (it fills stellarBoostedTypes),
 * so the rest is mirrored here and test/stab-rules.spec.ts holds it against
 * the damage the simulator deals.
 */
function stabMultiplier(attacker: Pokemon, defender: Pokemon, move: DexMove, type: string, battle: Battle): number {
  if (type === '???') return 1;
  const tera = attacker.terastallized;
  const oldType = attacker.types.includes(type);
  const stab = oldType || (tera !== 'Stellar' && tera === type) ? 1.5 : 1;
  if (tera === 'Stellar') {
    if (attacker.stellarBoostedTypes.includes(type)) return stab;
    return oldType ? 2 : 4915 / 4096;
  }
  const rule = tera === type && oldType ? 2 : stab;
  return rule > 1 ? abilityStab(attacker, defender, move, rule, battle) : rule;
}

/**
 * getDamage's floor: once the user terastallized, a move of its Tera type
 * (a Stellar body: of a type not yet boosted) under 60 power hits as 60,
 * unless it has priority, hits more than once or sets a power of 0 or 150
 * at use; mirrored for the same reason, held by test/stab-rules.spec.ts.
 */
function teraFloor(attacker: Pokemon, move: DexMove, type: string, power: number): boolean {
  const tera = attacker.terastallized;
  if (!tera || power >= 60 || move.priority > 0 || move.multihit) return false;
  if (move.basePowerCallback && (move.basePower === 0 || move.basePower === 150)) return false;
  return tera === 'Stellar' ? !attacker.stellarBoostedTypes.includes(type) : tera === type;
}

/** singleMoveFraction for a move already resolved at use (pairThreat resolves each slot once). */
function landedFraction(attacker: Pokemon, defender: Pokemon, move: DexMove, use: Landed, battle: Battle): number {
  // The defender's LIVE types: smogtours-gen9ou-751207 t6 priced Body Press
  // into a Ceruledge that had terastallized to Fighting at 0, as into a Ghost
  // (50 such false immunities on the bank's Tera positions, round 54).
  const defenderTypes = liveTypes(defender);
  if (blanked(attacker, defender, move, use.type, defenderTypes, battle)) return 0;
  if (!use.basePower) return (use.simDamage ?? fixedDamage(move, attacker, defender)) / defender.maxhp;
  const typeMult = Math.pow(2, battle.dex.getEffectiveness(use.type, defenderTypes));
  // A Stellar move hits a terastallized target twice as hard (pokemon.runEffectiveness).
  const stellar = use.type === 'Stellar' && defender.terastallized ? 2 : 1;
  const stab = stabMultiplier(attacker, defender, move, use.type, battle);
  const offense = offenseMultiplier(attacker, defender, use);
  // Body Press off the user's Defense, Psyshock against the target's, Foul Play off the target's Attack.
  const physical = use.category === 'Physical';
  const defense = defenseStat(move, physical);
  const atk = (move.overrideOffensivePokemon === 'target' ? defender : attacker).storedStats[offenseStat(move, physical)];
  const def = (move.overrideDefensivePokemon === 'source' ? attacker : defender).storedStats[defense];
  const bulk = bulkMultiplier(defender, defense);
  const level = 2 * attacker.level / 5 + 2;
  const powered = teraFloor(attacker, move, use.type, use.basePower * (use.powerMult ?? 1))
    ? level * 60
    : level * use.basePower * (use.powerMult ?? 1);
  const damage = ((powered * atk / def) / 50 + 2) * stab * typeMult * stellar * offense / bulk * (use.landing ?? 1);
  return damage / defender.maxhp;
}

export function pairThreat(attacker: Pokemon, defender: Pokemon, battle: Battle): PairThreat {
  let physical = 0;
  let special = 0;
  let physicalAcc = 1;
  let specialAcc = 1;
  let priority = false;
  // A choice-locked attacker only ever clicks its locked move again — a lock
  // into a resisted attack (or a status move) ends its threat outright.
  const locked = lockedMoveId(attacker);
  const usable = usableSlots(attacker);
  const slots = locked ? usable.filter(slot => slot.id === locked) : usable;
  let axes: AxisThreat[] | undefined;
  for (const slot of slots) {
    const move = battle.dex.moves.get(slot.id);
    if (!move.exists || move.category === 'Status') continue;
    const staged = POWER_MOVES.get(move.id) === 'stages';
    const use = threatUse(attacker, defender, move, battle, staged);
    const moveFraction = landedFraction(attacker, defender, move, use, battle);
    if (moveFraction > 0) {
      const accuracy = accuracyOf(move);
      if (staged || offAxis(move)) {
        (axes ??= []).push(axisThreat(move, use, moveFraction, accuracy, staged));
      } else if (use.category === 'Physical') {
        if (moveFraction > physical) { physical = moveFraction; physicalAcc = accuracy; }
      } else if (moveFraction > special) { special = moveFraction; specialAcc = accuracy; }
      if (move.priority > 0) priority = true;
    }
  }
  return { physical, special, priority, physicalAcc, specialAcc, ...(axes ? { axes } : {}) };
}

/** A slot as the memo prices it: at use, a stages-class move on no boosts (boostedFraction adds them). */
const threatUse = (attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle, staged: boolean): Landed =>
  (staged ? stagedLanded(attacker, defender, move, battle) : landedOrCatalog(attacker, defender, move, battle));

const accuracyOf = (move: DexMove): number => (move.accuracy === true ? 1 : move.accuracy / 100);

/** The PairThreat.axes entry of one move: its stats from the Dex, its power if the boosts set it. */
function axisThreat(move: DexMove, use: Landed, fraction: number, acc: number, staged: boolean): AxisThreat {
  const physical = use.category === 'Physical';
  return {
    fraction, acc,
    holder: move.overrideOffensivePokemon === 'target' ? 'defender' : 'attacker',
    offense: offenseStat(move, physical),
    defense: defenseStat(move, physical),
    ...(staged ? { staged: { id: move.id, basePower: use.basePower } } : {}),
  };
}

/** Stages that override the attacker's live ones (a setup move's would-be boosts). */
export type StageOverride = Partial<BoostsTable>;

/**
 * The memoized threat with the CURRENT boost stages applied. Stages stay
 * outside the memo key on purpose — they change between forked positions of
 * one search while the cached part does not. This is what makes setup moves
 * visible to the matchup term: +2 Atk doubles the pressure on every pair,
 * not just the flat boost weight. The optional override substitutes the
 * attacker's stages (candidate hints price a setup move by the stages it
 * WOULD grant); defender stages always read live. Since round 63 (T81) each
 * move reads the stages of its own stats (PairThreat.axes), and a move whose
 * power the boosts set asks the simulator for that power on these stages.
 */
export function boostedFraction(threat: PairThreat, attacker: Pokemon, defender: Pokemon, attackerBoosts?: StageOverride): number {
  return stagedFraction(threat, attacker, defender, attackerBoosts, false);
}

/** boostedFraction, each fraction weighed by its move's accuracy when asked (expectedRate, round 14). */
export function stagedFraction(
  threat: PairThreat,
  attacker: Pokemon,
  defender: Pokemon,
  attackerBoosts: StageOverride | undefined,
  withAccuracy: boolean,
): number {
  const atkStage = attackerBoosts?.atk ?? attacker.boosts.atk;
  const spaStage = attackerBoosts?.spa ?? attacker.boosts.spa;
  const physical = threat.physical * (withAccuracy ? threat.physicalAcc ?? 1 : 1) *
    stageMultiplier(atkStage) / stageMultiplier(defender.boosts.def);
  const special = threat.special * (withAccuracy ? threat.specialAcc ?? 1 : 1) *
    stageMultiplier(spaStage) / stageMultiplier(defender.boosts.spd);
  let best = Math.max(physical, special);
  for (const axis of threat.axes ?? []) best = Math.max(best, axisFraction(axis, attacker, defender, attackerBoosts, withAccuracy));
  return best;
}

function axisFraction(axis: AxisThreat, attacker: Pokemon, defender: Pokemon, attackerBoosts: StageOverride | undefined, withAccuracy: boolean): number {
  const offenseStage = axis.holder === 'attacker'
    ? attackerBoosts?.[axis.offense] ?? attacker.boosts[axis.offense]
    : defender.boosts[axis.offense];
  const value = axis.fraction * (withAccuracy ? axis.acc : 1) *
    stageMultiplier(offenseStage) / stageMultiplier(defender.boosts[axis.defense]);
  if (!axis.staged) return value;
  return value * stagedPower(attacker, defender, axis.staged.id, attackerBoosts) / axis.staged.basePower;
}

export type ThreatGetter = (attacker: Pokemon, defender: Pokemon) => PairThreat;

/** Memoizing accessor for pairThreat over one search's MatchupCache. */
export function threatGetter(battle: Battle, cache?: MatchupCache): ThreatGetter {
  return (attacker: Pokemon, defender: Pokemon): PairThreat => {
    if (!cache) return pairThreat(attacker, defender, battle);
    const key = pairKey(attacker, defender, battle);
    let value = cache.get(key);
    if (value === undefined) {
      value = pairThreat(attacker, defender, battle);
      cache.set(key, value);
    }
    return value;
  };
}
