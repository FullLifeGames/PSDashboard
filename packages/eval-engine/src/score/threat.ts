import type { Battle, BoostsTable, ID, Pokemon, Side, StatIDExceptHP } from '@pkmn/sim';
import { stageMultiplier } from '../stat-stages.ts';
import {
  abilityStab, keyedAnswers, landedKey, landedOrCatalog, stagedLanded, stagedPower, traitsOf, type Landed,
} from './move-facts.ts';
import type { StaticRuleset } from './weights.ts';


export const livingOf = (side: Side): Pokemon[] =>
  side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
export const livingMons = (battle: Battle, index: number): Pokemon[] => livingOf(battle.sides[index]);

/** HP- and boost-independent threat estimate of one attacker→defender direction. */
export interface PairThreat {
  /** Expected damage of the best physical move as a fraction of the defender's max HP (`special`: the same). */
  physical: number;
  special: number;
  priority: boolean;
  /** Accuracy 0 to 1 of the category-max move; only the narrative race reads it, the score never does. */
  physicalAcc?: number;
  specialAcc?: number;
  /** Ids of the moves behind `physical` and `special`, for the race's hit (score/contact.ts); absent: no hit priced. */
  physicalMove?: string;
  specialMove?: string;
  /** Moves that read other stages than their category's (Body Press, Psyshock, Foul Play, boost-set power). */
  axes?: AxisThreat[];
}

/** One move whose damage reads other stages than its category's (PairThreat.axes). */
export interface AxisThreat {
  fraction: number;
  acc: number;
  id?: string;
  holder: 'attacker' | 'defender';
  offense: StatIDExceptHP;
  defense: StatIDExceptHP;
  staged?: { id: string; basePower: number };
}

/** The memo of the boost-independent threat of one search, a function of its key (pairKey). */
export type MatchupCache = Map<string, PairThreat> & {
  /** The rule set whose weight table the static applies; the memo is weight-free, a plain Map reads as 'standard'. */
  readonly ruleset: StaticRuleset;
};

/** A search's memo under its rule set; an unset rule set reads as 'standard'. */
export function createMatchupCache(ruleset: StaticRuleset | undefined): MatchupCache {
  return Object.assign(new Map<string, PairThreat>(), { ruleset: ruleset ?? 'standard' });
}

function lockedMoveId(pokemon: Pokemon): string | null {
  const locked = pokemon.volatiles['choicelock'] as { move?: string } | undefined;
  return locked?.move ?? null;
}

/** Move slots with PP left to click; PP is read live from the sim state, a slot without a pp field stays usable. */
export function usableSlots(pokemon: Pokemon): Pokemon['moveSlots'] {
  return pokemon.moveSlots.filter(slot => (slot.pp ?? 1) > 0);
}

// oracle: packages/eval-engine/test/halving-moves-oracle.spec.ts
export const HALVING_MOVES: ReadonlySet<string> = new Set(['superfang', 'naturesmadness', 'ruination']);

function pairKey(
  attacker: Pokemon,
  defender: Pokemon,
  slots: Pokemon['moveSlots'],
  answers: ReadonlyMap<string, Landed> | null,
): string {
  // The memo must be a function of its key (a worker pool keeps one cache per worker): every read of pairThreat and
  // singleMoveFraction needs its key term, or a cell follows which worker priced it first (test/threat.spec.ts).
  const usable = slots.map(slot => slot.id).join(',');
  // A halving move prices off the defender's current HP: the pair keys on it, or the first position to ask freezes it.
  const liveHp = slots.some(slot => HALVING_MOVES.has(slot.id)) ? `:${defender.hp}` : '';
  // A Tera click leaves `types` and sets `terastallized`: both are keyed; the defender's term mirrors liveTypes,
  // the attacker's the STAB rules (a Stellar body: the types it has spent its boost on).
  const stellar = attacker.terastallized === 'Stellar' ? `:${attacker.stellarBoostedTypes.join('/')}` : '';
  const offense = `${attacker.types.join('/')}:${attacker.terastallized ?? ''}${stellar}:${attacker.storedStats.atk}:${attacker.storedStats.spa}`;
  const defense = `${defender.types.join('/')}:${defender.terastallized ?? ''}:${defender.storedStats.def}:${defender.storedStats.spd}:${defender.maxhp}`;
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}:${usable}:${offense}>` +
    `${defender.side.id}:${defender.name}:${defender.species.id}:${defender.level}:${defender.item}:${defender.ability}:${defense}${liveHp}` +
    axisKey(attacker, defender, slots) + landedKey(answers);
}

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

/** The types a body defends with: the sim's `types` (a Tera click leaves them), not `getTypes()` (Roost, added). */
export function liveTypes(pokemon: Pokemon): string[] {
  const tera = pokemon.terastallized;
  return tera && tera !== 'Stellar' ? [tera] : pokemon.types;
}

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

const ABILITY_FLAG_IMMUNITIES: Record<string, 'wind' | 'sound' | 'bullet'> = {
  windrider: 'wind',
  soundproof: 'sound',
  bulletproof: 'bullet',
};

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

function offenseMultiplier(attacker: Pokemon, defender: Pokemon, use: Landed): number {
  let offense = 1;
  if (attacker.item === 'lifeorb') offense *= 1.3;
  if (attacker.item === 'choiceband' && use.category === 'Physical') offense *= 1.5;
  if (attacker.item === 'choicespecs' && use.category === 'Special') offense *= 1.5;
  if (defender.ability === 'thickfat' && (use.type === 'Fire' || use.type === 'Ice')) offense *= 0.5;
  return offense;
}

// getDamage modifies the stat the move reads (defenseStat), so Psyshock passes an Assault Vest.
function bulkMultiplier(defender: Pokemon, defense: StatIDExceptHP): number {
  let bulk = 1;
  if (defender.item === 'eviolite' && defender.species.nfe) bulk *= 1.5;
  if (defender.item === 'assaultvest' && defense === 'spd') bulk *= 1.5;
  return bulk;
}


// Level moves deal the user's level, halving moves half the target's HP; the reactive family and self-sacrifice stay 0.
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

function ignoresImmunity(attacker: Pokemon, type: string): boolean {
  return (attacker.ability === 'scrappy' || attacker.ability === 'mindseye') && (type === 'Normal' || type === 'Fighting');
}

/** Expected damage of one move as a fraction of the defender's max HP; 0 for status, reactive and immune moves. */
export function singleMoveFraction(attacker: Pokemon, defender: Pokemon, moveId: string, battle: Battle): number {
  const move = battle.dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status') return 0;
  return landedFraction(attacker, defender, move, landedOrCatalog(attacker, defender, move, battle), battle);
}

function blanked(attacker: Pokemon, defender: Pokemon, move: DexMove, type: string, defenderTypes: string[], battle: Battle): boolean {
  if ((ABILITY_IMMUNITIES[defender.ability] ?? []).includes(type)) return true;
  const blankedFlag = ABILITY_FLAG_IMMUNITIES[defender.ability];
  if (blankedFlag && move.flags[blankedFlag]) return true;
  return !ignoresImmunity(attacker, type) && !battle.dex.getImmunity(type, defenderTypes);
}

const offenseStat = (move: DexMove, physical: boolean): StatIDExceptHP => move.overrideOffensiveStat ?? (physical ? 'atk' : 'spa');
const defenseStat = (move: DexMove, physical: boolean): StatIDExceptHP => move.overrideDefensiveStat ?? (physical ? 'def' : 'spd');

// BattleActions#modifyDamage writes the battle, so its STAB rules are mirrored (test/threat.stab-rules.spec.ts).
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

// getDamage's 60-power floor for a Tera-type move, mirrored and held by test/threat.stab-rules.spec.ts.
function teraFloor(attacker: Pokemon, move: DexMove, type: string, power: number): boolean {
  const tera = attacker.terastallized;
  if (!tera || power >= 60 || move.priority > 0 || move.multihit) return false;
  if (move.basePowerCallback && (move.basePower === 0 || move.basePower === 150)) return false;
  return tera === 'Stellar' ? !attacker.stellarBoostedTypes.includes(type) : tera === type;
}

function landedFraction(attacker: Pokemon, defender: Pokemon, move: DexMove, use: Landed, battle: Battle): number {
  // Live types, not `defender.types`: after a Tera click the sim leaves `types` at the old ones.
  const defenderTypes = liveTypes(defender);
  if (blanked(attacker, defender, move, use.type, defenderTypes, battle)) return 0;
  if (!use.basePower) return (use.simDamage ?? fixedDamage(move, attacker, defender)) / defender.maxhp;
  const typeMult = Math.pow(2, battle.dex.getEffectiveness(use.type, defenderTypes));
  // A Stellar move hits a terastallized target twice as hard (pokemon.runEffectiveness).
  const stellar = use.type === 'Stellar' && defender.terastallized ? 2 : 1;
  const stab = stabMultiplier(attacker, defender, move, use.type, battle);
  const offense = offenseMultiplier(attacker, defender, use);
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

/** The threat of one direction; threatGetter passes what the memo key already read (`known`, usable slots). */
export function pairThreat(
  attacker: Pokemon,
  defender: Pokemon,
  battle: Battle,
  known?: ReadonlyMap<string, Landed> | null,
  usable: Pokemon['moveSlots'] = usableSlots(attacker),
): PairThreat {
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

function addMove(threat: PairThreat, move: DexMove, use: Landed, fraction: number, ownAxis: boolean | null): void {
  const accuracy = accuracyOf(move);
  if (ownAxis !== null) {
    (threat.axes ??= []).push(axisThreat(move, use, fraction, accuracy, ownAxis));
  } else if (use.category === 'Physical') {
    if (fraction > threat.physical) { threat.physical = fraction; threat.physicalAcc = accuracy; threat.physicalMove = move.id; }
  } else if (fraction > threat.special) { threat.special = fraction; threat.specialAcc = accuracy; threat.specialMove = move.id; }
  if (move.priority > 0) threat.priority = true;
}

const threatUse = (attacker: Pokemon, defender: Pokemon, move: DexMove, battle: Battle, staged: boolean): Landed =>
  (staged ? stagedLanded(attacker, defender, move, battle) : landedOrCatalog(attacker, defender, move, battle));

const accuracyOf = (move: DexMove): number => (move.accuracy === true ? 1 : move.accuracy / 100);

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

/** The memoized threat on the CURRENT stages (kept out of the memo key); `attackerBoosts` replaces the attacker's. */
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

/** The id of the move boostedFraction reads, or null when no damaging move is left or the threat carries no ids. */
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
