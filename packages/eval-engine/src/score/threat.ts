import type { Battle, BoostsTable, ID, Pokemon, Side, StatIDExceptHP } from '@pkmn/sim';
import { stageMultiplier } from '../stat-stages.ts';
import {
  abilityStab, keyedAnswers, landedKey, landedOrCatalog, stagedLanded, stagedPower, traitsOf, type Landed,
} from './move-facts.ts';
import type { StaticRuleset } from './weights.ts';

// The HP- and boost-independent threat proxy: one direction's best expected move fractions, memoized per search, live stages applied on read.

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
   * Accuracy (0-1, 1 = never misses) of the category-max move. The narrative race weighs its rates by it (a 70% Hurricane is no
   * full-hit clock); the SCORE path never reads it (matchup and coverage stay on the raw fractions). Optional so hand-built threats
   * in tests keep working; consumers default to 1.
   */
  physicalAcc?: number;
  specialAcc?: number;
  /**
   * The ids of the moves behind `physical` and `special`: the race plays the hit of the move it prices (score/contact.ts). Optional
   * like the accuracies; a hand-built threat has none and prices no hit.
   */
  physicalMove?: string;
  specialMove?: string;
  /**
   * Moves whose stages are not their category's, each with its own best fraction at stage 0: Body Press (the user's Defense),
   * Psyshock (the target's Defense), Foul Play (the target's Attack), and the moves whose power the boosts set (Stored Power, Power
   * Trip), priced at the power of no boosts. Absent on an ordinary pair.
   */
  axes?: AxisThreat[];
}

/** One move whose damage reads other stages than its category's (PairThreat.axes). */
export interface AxisThreat {
  fraction: number;
  acc: number;
  id?: string;
  /** Whose offensive stage the damage reads, and which. */
  holder: 'attacker' | 'defender';
  offense: StatIDExceptHP;
  /** The target's defensive stage the damage reads. */
  defense: StatIDExceptHP;
  /** A move whose power the boosts set: its id and the power its fraction was priced at. */
  staged?: { id: string; basePower: number };
}

/** The memo of the boost-independent threat of one search, a function of its key (pairKey). */
export type MatchupCache = Map<string, PairThreat> & {
  /** The rule set whose weight table the static applies (score/weights.ts); the memo itself is weight-free, and a plain Map reads as 'standard'. */
  readonly ruleset: StaticRuleset;
};

/** A search's memo under its rule set: the argument is required, an unset optional rule set (EvalSettings.ruleset) reads as 'standard'. */
export function createMatchupCache(ruleset: StaticRuleset | undefined): MatchupCache {
  return Object.assign(new Map<string, PairThreat>(), { ruleset: ruleset ?? 'standard' });
}

function lockedMoveId(pokemon: Pokemon): string | null {
  const locked = pokemon.volatiles['choicelock'] as { move?: string } | undefined;
  return locked?.move ?? null;
}

/**
 * Move slots with PP left to click. PP is read LIVE from the sim state, never derived from dex base PP (pools differ across rule sets:
 * Pokémon Champions runs different counts). A slot without a pp field stays usable. A fully drained mon could still Struggle, but its
 * chip is no sustained threat: it prices as threatless (a Struggle-locked Toxapex kept pricing as a full wall while it recoiled itself out).
 */
export function usableSlots(pokemon: Pokemon): Pokemon['moveSlots'] {
  return pokemon.moveSlots.filter(slot => (slot.pp ?? 1) > 0);
}

/** Moves that deal half the target's CURRENT HP. */
// oracle: packages/eval-engine/test/halving-moves-oracle.spec.ts
export const HALVING_MOVES: ReadonlySet<string> = new Set(['superfang', 'naturesmadness', 'ruination']);

function pairKey(
  attacker: Pokemon,
  defender: Pokemon,
  slots: Pokemon['moveSlots'],
  answers: ReadonlyMap<string, Landed> | null,
): string {
  // The memo MUST be a function of its key: the app splits one matrix over a worker pool with one cache per worker, so a value that
  // depends on what a cache saw first differs run to run (two runs of one doubles replay disagreed on single cells). The key carries
  // EVERY read of pairThreat and singleMoveFraction (a new read needs its key term, test/threat.spec.ts): level, item, ability,
  // choice lock, usable slots, current types (Protean, Soak, Burn Up), the Tera type, the stored stats it divides (Power Trick, Guard
  // Split), the defender's max HP (forme change, Dynamax). A move whose answer at use reads a fact the key does not name (weather,
  // terrain, grounding, stages, Hidden Power, a power the simulator sets from HP, status, field, speed or weight) keys its answer
  // instead (landedKey, CONTEXT_MOVES in move-use.ts, the live class of POWER_MOVES in move-facts.ts).
  // The usable-slot signature keys PP transitions: a move draining to zero mid-search changes the attacker's threat.
  const usable = slots.map(slot => slot.id).join(',');
  // A halving move prices off the defender's current HP, so such a pair keys on it: otherwise the first forked position to ask would
  // freeze its HP into the memo for the whole search, and with a worker pool the value of a cell would follow which worker priced it.
  const liveHp = slots.some(slot => HALVING_MOVES.has(slot.id)) ? `:${defender.hp}` : '';
  // Types and stored stats are constant for nearly every pair but change under Protean, Soak, Power Trick and their kin: the key
  // carries them. A Tera click leaves `types` alone and sets `terastallized`, so both are keyed. The defender's term mirrors liveTypes
  // (a Stellar body keeps its old types for defense); the attacker's mirrors STAB by the rules (a Stellar body: the types it has spent
  // its boost on).
  const stellar = attacker.terastallized === 'Stellar' ? `:${attacker.stellarBoostedTypes.join('/')}` : '';
  const offense = `${attacker.types.join('/')}:${attacker.terastallized ?? ''}${stellar}:${attacker.storedStats.atk}:${attacker.storedStats.spa}`;
  const defense = `${defender.types.join('/')}:${defender.terastallized ?? ''}:${defender.storedStats.def}:${defender.storedStats.spd}:${defender.maxhp}`;
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}:${usable}:${offense}>` +
    `${defender.side.id}:${defender.name}:${defender.species.id}:${defender.level}:${defender.item}:${defender.ability}:${defense}${liveHp}` +
    axisKey(attacker, defender, slots) + landedKey(answers);
}

/**
 * The stored stats an off-axis slot reads besides the attacker's atk/spa and the defender's def/spd: Body Press the user's Defense,
 * Foul Play the target's Attack, as the Dex names them. Guard Split and Power Split write exactly these. Both category variants are
 * keyed, so a move whose category flips at use stays exact. '' for a pair without such a slot.
 */
function axisKey(attacker: Pokemon, defender: Pokemon, slots: Pokemon['moveSlots']): string {
  const battle = attacker.battle;
  const { offAxis } = traitsOf(battle);
  let key = '';
  for (const slot of slots) {
    if (!offAxis.has(slot.id)) continue;
    const move = battle.dex.moves.getByID(slot.id as ID);
    const offense = (move.overrideOffensivePokemon === 'target' ? defender : attacker).storedStats;
    const defense = (move.overrideDefensivePokemon === 'source' ? attacker : defender).storedStats;
    key += `|${slot.id}=${offense[offenseStat(move, true)]}/${offense[offenseStat(move, false)]}` +
      `/${defense[defenseStat(move, true)]}/${defense[defenseStat(move, false)]}`;
  }
  return key;
}

/**
 * The types a body defends with. After a Tera click the sim keeps `types` at the old types and carries the new one in `terastallized`;
 * a Stellar Tera keeps the old types for defense. Not `getTypes()` on purpose: that adds Roost and the added types (Forest's Curse,
 * Trick-or-Treat). The shortcut is exact at a turn boundary: the click clears an added type, and Roost does not outlast its turn.
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
 * Defender abilities that blank a move FLAG instead of a type (Hurricane into a Wind Rider Shiftry priced 277 % of its HP where the
 * damage calc reads 0).
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
 * The defender's bulk items: Eviolite on an NFE, Assault Vest on Special Defense. The sim modifies the defensive stat the move reads
 * (getDamage: Modify<Def|SpD> of defenseStat), so Psyshock passes an Assault Vest; the offensive modifiers follow the category.
 */
function bulkMultiplier(defender: Pokemon, defense: StatIDExceptHP): number {
  let bulk = 1;
  if (defender.item === 'eviolite' && defender.species.nfe) bulk *= 1.5;
  if (defender.item === 'assaultvest' && defense === 'spd') bulk *= 1.5;
  return bulk;
}


/**
 * Fixed damage the proxy can price without a base power (a last-pair race must see a Seismic Toss Chansey as an attacker). Level
 * moves deal the user's level, the halving moves half the target's current HP; the reactive family (Counter, Mirror Coat, Metal
 * Burst) and self-sacrifice stay at 0. Endeavor's HP difference comes from the simulator (landedOrCatalog).
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
 * Expected damage of one move as a fraction of the defender's max HP under the proxy's rules: the damage formula with STAB, the type
 * chart and the big item/ability modifiers; fixed-damage moves at their amount; 0 for status, reactive and immune moves. Type,
 * category and power are the move's at use (move-use.ts; the power the simulator sets at use, move-facts.ts).
 */
export function singleMoveFraction(attacker: Pokemon, defender: Pokemon, moveId: string, battle: Battle): number {
  const move = battle.dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status') return 0;
  return landedFraction(attacker, defender, move, landedOrCatalog(attacker, defender, move, battle), battle);
}

/** The defender's ability or types blank the move (the proxy's immunities). */
function blanked(attacker: Pokemon, defender: Pokemon, move: DexMove, type: string, defenderTypes: string[], battle: Battle): boolean {
  if ((ABILITY_IMMUNITIES[defender.ability] ?? []).includes(type)) return true;
  const blankedFlag = ABILITY_FLAG_IMMUNITIES[defender.ability];
  if (blankedFlag && move.flags[blankedFlag]) return true;
  return !ignoresImmunity(attacker, type) && !battle.dex.getImmunity(type, defenderTypes);
}

/** The stats getDamage reads: the Dex entry's override, else the category's own. */
const offenseStat = (move: DexMove, physical: boolean): StatIDExceptHP => move.overrideOffensiveStat ?? (physical ? 'atk' : 'spa');
const defenseStat = (move: DexMove, physical: boolean): StatIDExceptHP => move.overrideDefensiveStat ?? (physical ? 'def' : 'spd');

/**
 * STAB by the game's rules (BattleActions#modifyDamage): an old type or the Tera type 1.5, an old type that is also the Tera type
 * 2.0; a Stellar Tera 2.0 on an old type and 1.2 elsewhere, on the first use of a type only (the sim's stellarBoostedTypes, which
 * Terapagos-Stellar never fills); then the attacker's own ModifySTAB handler (Adaptability), asked from the simulator. modifyDamage
 * writes the battle (it fills stellarBoostedTypes), so the rest is mirrored here and test/threat.stab-rules.spec.ts holds it
 * against the damage the simulator deals.
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
  return rule > 1 && traitsOf(battle).stabAbilities.has(attacker.ability) ? abilityStab(attacker, defender, move, rule, battle) : rule;
}

/**
 * getDamage's floor: once the user terastallized, a move of its Tera type (a Stellar body: of a type not yet boosted) under 60 power
 * hits as 60, unless it has priority, hits more than once or sets a power of 0 or 150 at use; mirrored, held by
 * test/threat.stab-rules.spec.ts.
 */
function teraFloor(attacker: Pokemon, move: DexMove, type: string, power: number): boolean {
  const tera = attacker.terastallized;
  if (!tera || power >= 60 || move.priority > 0 || move.multihit) return false;
  if (move.basePowerCallback && (move.basePower === 0 || move.basePower === 150)) return false;
  return tera === 'Stellar' ? !attacker.stellarBoostedTypes.includes(type) : tera === type;
}

/** singleMoveFraction for a move already resolved at use (pairThreat resolves each slot once). */
function landedFraction(attacker: Pokemon, defender: Pokemon, move: DexMove, use: Landed, battle: Battle): number {
  // The defender's LIVE types: Body Press into a Ceruledge that had terastallized to Fighting priced at 0, as into a Ghost (50 such
  // false immunities on the bank's Tera positions).
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

/** The threat of one direction; threatGetter hands over what the memo key already read: the keyed answers (`known`) and the usable slots. */
export function pairThreat(
  attacker: Pokemon,
  defender: Pokemon,
  battle: Battle,
  known?: ReadonlyMap<string, Landed> | null,
  usable: Pokemon['moveSlots'] = usableSlots(attacker),
): PairThreat {
  // A choice-locked attacker only ever clicks its locked move again: a lock into a resisted attack (or a status move) ends its threat.
  const locked = lockedMoveId(attacker);
  const slots = locked ? usable.filter(slot => slot.id === locked) : usable;
  const threat: PairThreat = { physical: 0, special: 0, priority: false, physicalAcc: 1, specialAcc: 1 };
  const traits = traitsOf(battle);
  for (const slot of slots) {
    // Slots carry ids, so the Dex is asked by id (moves.get would normalize the name first).
    const move = battle.dex.moves.getByID(slot.id as ID);
    if (!move.exists || move.category === 'Status') continue;
    const staged = traits.staged.has(move.id);
    const use = known?.get(move.id) ?? threatUse(attacker, defender, move, battle, staged);
    const fraction = landedFraction(attacker, defender, move, use, battle);
    if (fraction > 0) addMove(threat, move, use, fraction, staged || traits.offAxis.has(move.id) ? staged : null);
  }
  return threat;
}

/** One move into the threat: the best of its category, or its own entry (`ownAxis` set: staged or off-axis). */
function addMove(threat: PairThreat, move: DexMove, use: Landed, fraction: number, ownAxis: boolean | null): void {
  const accuracy = accuracyOf(move);
  if (ownAxis !== null) {
    (threat.axes ??= []).push(axisThreat(move, use, fraction, accuracy, ownAxis));
  } else if (use.category === 'Physical') {
    if (fraction > threat.physical) { threat.physical = fraction; threat.physicalAcc = accuracy; threat.physicalMove = move.id; }
  } else if (fraction > threat.special) { threat.special = fraction; threat.specialAcc = accuracy; threat.specialMove = move.id; }
  if (move.priority > 0) threat.priority = true;
}

/** A slot as the memo prices it: at use, a stages-class move on no boosts (boostedFraction adds them). */
const threatUse = (attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle, staged: boolean): Landed =>
  (staged ? stagedLanded(attacker, defender, move, battle) : landedOrCatalog(attacker, defender, move, battle));

const accuracyOf = (move: DexMove): number => (move.accuracy === true ? 1 : move.accuracy / 100);

/** The PairThreat.axes entry of one move: its stats from the Dex, its power if the boosts set it. */
function axisThreat(move: DexMove, use: Landed, fraction: number, acc: number, staged: boolean): AxisThreat {
  const physical = use.category === 'Physical';
  return {
    fraction, acc, id: move.id,
    holder: move.overrideOffensivePokemon === 'target' ? 'defender' : 'attacker',
    offense: offenseStat(move, physical),
    defense: defenseStat(move, physical),
    ...(staged ? { staged: { id: move.id, basePower: use.basePower } } : {}),
  };
}

/** Stages that override the attacker's live ones (a setup move's would-be boosts). */
export type StageOverride = Partial<BoostsTable>;

/**
 * The memoized threat with the CURRENT boost stages applied. Stages stay outside the memo key on purpose: they change between forked
 * positions of one search while the cached part does not. This makes setup moves visible to the matchup term (+2 Atk doubles the
 * pressure on every pair). The optional override substitutes the attacker's stages (candidate hints price a setup move by the stages
 * it WOULD grant); defender stages always read live. Each move reads the stages of its own stats (PairThreat.axes), and a move whose
 * power the boosts set asks the simulator for that power on these stages.
 */
export function boostedFraction(threat: PairThreat, attacker: Pokemon, defender: Pokemon, attackerBoosts?: StageOverride): number {
  const atkStage = attackerBoosts?.atk ?? attacker.boosts.atk;
  const spaStage = attackerBoosts?.spa ?? attacker.boosts.spa;
  const physical = threat.physical * stageMultiplier(atkStage) / stageMultiplier(defender.boosts.def);
  const special = threat.special * stageMultiplier(spaStage) / stageMultiplier(defender.boosts.spd);
  const best = Math.max(physical, special);
  return threat.axes ? Math.max(best, axesFraction(threat.axes, attacker, defender, attackerBoosts, false)) : best;
}

/** boostedFraction with each fraction weighed by its move's accuracy (the narrative race's rate). */
export function expectedFraction(threat: PairThreat, attacker: Pokemon, defender: Pokemon): number {
  const physical = threat.physical * (threat.physicalAcc ?? 1) *
    stageMultiplier(attacker.boosts.atk) / stageMultiplier(defender.boosts.def);
  const special = threat.special * (threat.specialAcc ?? 1) *
    stageMultiplier(attacker.boosts.spa) / stageMultiplier(defender.boosts.spd);
  const best = Math.max(physical, special);
  return threat.axes ? Math.max(best, axesFraction(threat.axes, attacker, defender, undefined, true)) : best;
}

function axesFraction(axes: AxisThreat[], attacker: Pokemon, defender: Pokemon, attackerBoosts: StageOverride | undefined, withAccuracy: boolean): number {
  let best = 0;
  for (const axis of axes) best = Math.max(best, axisFraction(axis, attacker, defender, attackerBoosts, withAccuracy));
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

/**
 * The id of the move boostedFraction reads: the best of the physical and special moves and the off-axis entries on the
 * stages in view, or null when no damaging move is left (or the threat carries no ids). The races of boostsBiting
 * play a hit of this move.
 */
export function bestMoveId(threat: PairThreat, attacker: Pokemon, defender: Pokemon, attackerBoosts?: StageOverride): string | null {
  const atkStage = attackerBoosts?.atk ?? attacker.boosts.atk;
  const spaStage = attackerBoosts?.spa ?? attacker.boosts.spa;
  let best = 0;
  let id: string | null = null;
  const physical = threat.physical * stageMultiplier(atkStage) / stageMultiplier(defender.boosts.def);
  if (physical > best) { best = physical; id = threat.physicalMove ?? null; }
  const special = threat.special * stageMultiplier(spaStage) / stageMultiplier(defender.boosts.spd);
  if (special > best) { best = special; id = threat.specialMove ?? null; }
  for (const axis of threat.axes ?? []) {
    const value = axisFraction(axis, attacker, defender, attackerBoosts, false);
    if (value > best) { best = value; id = axis.id ?? null; }
  }
  return id;
}

export type ThreatGetter = (attacker: Pokemon, defender: Pokemon) => PairThreat;

/** Memoizing accessor for pairThreat over one search's MatchupCache. */
export function threatGetter(battle: Battle, cache?: MatchupCache): ThreatGetter {
  return (attacker: Pokemon, defender: Pokemon): PairThreat => {
    if (!cache) return pairThreat(attacker, defender, battle);
    const slots = usableSlots(attacker);
    const answers = keyedAnswers(attacker, defender, slots, battle);
    const key = pairKey(attacker, defender, slots, answers);
    let value = cache.get(key);
    if (value === undefined) {
      value = pairThreat(attacker, defender, battle, answers, slots);
      cache.set(key, value);
    }
    return value;
  };
}
