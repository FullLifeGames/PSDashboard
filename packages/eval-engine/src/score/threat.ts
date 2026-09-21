import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { stageMultiplier } from '../stat-stages.ts';

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
 * singleMoveFraction needs its key term (test/threat-memo.spec.ts).
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

function pairKey(attacker: Pokemon, defender: Pokemon): string {
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
  // attacker's term mirrors no read while STAB stays tera-blind: it is kept
  // for the parked rule (branch r54-stab, T71) and costs one memo entry a click.
  const offense = `${attacker.types.join('/')}:${attacker.terastallized ?? ''}:${attacker.storedStats.atk}:${attacker.storedStats.spa}`;
  const defense = `${defender.types.join('/')}:${defender.terastallized ?? ''}:${defender.storedStats.def}:${defender.storedStats.spd}:${defender.maxhp}`;
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}:${usable}:${offense}>` +
    `${defender.side.id}:${defender.name}:${defender.species.id}:${defender.level}:${defender.item}:${defender.ability}:${defense}${liveHp}`;
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
function offenseMultiplier(attacker: Pokemon, defender: Pokemon, move: DexMove): number {
  let offense = 1;
  if (attacker.item === 'lifeorb') offense *= 1.3;
  if (attacker.item === 'choiceband' && move.category === 'Physical') offense *= 1.5;
  if (attacker.item === 'choicespecs' && move.category === 'Special') offense *= 1.5;
  if (defender.ability === 'thickfat' && (move.type === 'Fire' || move.type === 'Ice')) offense *= 0.5;
  return offense;
}

/** The defender's bulk items: Eviolite on an NFE, Assault Vest against special moves. */
function bulkMultiplier(defender: Pokemon, move: DexMove): number {
  let bulk = 1;
  if (defender.item === 'eviolite' && defender.species.nfe) bulk *= 1.5;
  if (defender.item === 'assaultvest' && move.category === 'Special') bulk *= 1.5;
  return bulk;
}

/**
 * Fixed damage the proxy can price without a base power (round 33: the
 * last-pair race must see a Seismic Toss Chansey as an attacker). Level
 * moves deal the user's level, the halving moves half the target's
 * current HP; the reactive family (Counter, Mirror Coat, Metal Burst) and
 * self-sacrifice stay at 0.
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

/**
 * Expected damage of one specific move as a fraction of the defender's max
 * HP under the proxy's rules — standard damage formula with STAB, the type
 * chart, and the big item/ability modifiers; fixed-damage moves at their
 * fixed amount; 0 for status, reactive, and immune moves.
 */
export function singleMoveFraction(attacker: Pokemon, defender: Pokemon, moveId: string, battle: Battle): number {
  const move = battle.dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status') return 0;
  const blanked = ABILITY_IMMUNITIES[defender.ability] ?? [];
  if (blanked.includes(move.type)) return 0;
  const blankedFlag = ABILITY_FLAG_IMMUNITIES[defender.ability];
  if (blankedFlag && move.flags[blankedFlag]) return 0;
  // The defender's LIVE types: smogtours-gen9ou-751207 t6 priced Body Press
  // into a Ceruledge that had terastallized to Fighting at 0, as into a Ghost
  // (50 such false immunities on the bank's Tera positions, round 54).
  const defenderTypes = liveTypes(defender);
  if (!battle.dex.getImmunity(move.type, defenderTypes)) return 0;
  if (!move.basePower) return fixedDamage(move, attacker, defender) / defender.maxhp;
  const typeMult = Math.pow(2, battle.dex.getEffectiveness(move.type, defenderTypes));
  // STAB stays tera-blind here: the rule by the book is parked on branch r54-stab (round 54).
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const offense = offenseMultiplier(attacker, defender, move);
  const bulk = bulkMultiplier(defender, move);
  const [atk, def] = move.category === 'Physical'
    ? [attacker.storedStats.atk, defender.storedStats.def]
    : [attacker.storedStats.spa, defender.storedStats.spd];
  const damage = (((2 * attacker.level / 5 + 2) * move.basePower * atk / def) / 50 + 2) *
    stab * typeMult * offense / bulk;
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
  for (const slot of slots) {
    const moveFraction = singleMoveFraction(attacker, defender, slot.id, battle);
    if (moveFraction > 0) {
      const move = battle.dex.moves.get(slot.id);
      const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
      if (move.category === 'Physical') {
        if (moveFraction > physical) { physical = moveFraction; physicalAcc = accuracy; }
      } else if (moveFraction > special) { special = moveFraction; specialAcc = accuracy; }
      if (move.priority > 0) priority = true;
    }
  }
  return { physical, special, priority, physicalAcc, specialAcc };
}

/**
 * The memoized threat with the CURRENT boost stages applied. Stages stay
 * outside the memo key on purpose — they change between forked positions of
 * one search while the cached part does not. This is what makes setup moves
 * visible to the matchup term: +2 Atk doubles the pressure on every pair,
 * not just the flat boost weight. The optional override substitutes the
 * attacker's offensive stages (candidate hints price a setup move by the
 * stages it WOULD grant); defender stages always read live.
 */
export function boostedFraction(
  threat: PairThreat,
  attacker: Pokemon,
  defender: Pokemon,
  attackerBoosts?: { atk?: number; spa?: number },
): number {
  const atkStage = attackerBoosts?.atk ?? attacker.boosts.atk;
  const spaStage = attackerBoosts?.spa ?? attacker.boosts.spa;
  const physical = threat.physical * stageMultiplier(atkStage) / stageMultiplier(defender.boosts.def);
  const special = threat.special * stageMultiplier(spaStage) / stageMultiplier(defender.boosts.spd);
  return Math.max(physical, special);
}

export type ThreatGetter = (attacker: Pokemon, defender: Pokemon) => PairThreat;

/** Memoizing accessor for pairThreat over one search's MatchupCache. */
export function threatGetter(battle: Battle, cache?: MatchupCache): ThreatGetter {
  return (attacker: Pokemon, defender: Pokemon): PairThreat => {
    if (!cache) return pairThreat(attacker, defender, battle);
    const key = pairKey(attacker, defender);
    let value = cache.get(key);
    if (value === undefined) {
      value = pairThreat(attacker, defender, battle);
      cache.set(key, value);
    }
    return value;
  };
}
