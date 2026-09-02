import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { stageMultiplier } from '../stat-stages';

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
 * Memo for the HP-independent part of the matchup term. One cache spans one
 * search: the memoized threat depends only on species/level/set properties,
 * which are constant across every forked position of the same battle.
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
export function usableSlots(pokemon: Pokemon) {
  return pokemon.moveSlots.filter(slot => (slot.pp ?? 1) > 0);
}

function pairKey(attacker: Pokemon, defender: Pokemon): string {
  // The usable-slot signature keys PP transitions: a move draining to zero
  // mid-search changes the attacker's threat, so it must miss the memo.
  const usable = usableSlots(attacker).map(slot => slot.id).join(',');
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}:${usable}>` +
    `${defender.side.id}:${defender.name}:${defender.species.id}:${defender.level}:${defender.item}:${defender.ability}`;
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
 * Best expected damage (as a fraction of the defender's max HP) among the
 * attacker's actual moves — standard damage formula with STAB, the type
 * chart, and the big item/ability modifiers. Status and fixed-damage moves
 * are invisible to this proxy.
 */
/**
 * Expected damage of one specific move as a fraction of the defender's max
 * HP under the proxy's rules — 0 for status/fixed-damage/immune moves.
 */
export function singleMoveFraction(attacker: Pokemon, defender: Pokemon, moveId: string, battle: Battle): number {
  const move = battle.dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status' || !move.basePower) return 0;
  const blanked = ABILITY_IMMUNITIES[defender.ability] ?? [];
  if (blanked.includes(move.type)) return 0;
  if (!battle.dex.getImmunity(move.type, defender.types)) return 0;
  const typeMult = Math.pow(2, battle.dex.getEffectiveness(move.type, defender.types));
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
