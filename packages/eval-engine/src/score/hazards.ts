import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { EVAL_WEIGHTS } from './weights.ts';
import { usableSlots } from './threat.ts';

/**
 * Hazards priced by their victims: the per-mon entry fraction, the capped
 * side cost, the stranded bench, and the removal option value.
 */

/** Removal moves that clear ONLY the user's side (pure relief). */
const OWN_SIDE_REMOVAL_MOVES = new Set(['rapidspin', 'mortalspin', 'tidyup']);
/** Removal moves that clear (or swap) BOTH sides — double-edged. */
const BOTH_SIDES_REMOVAL_MOVES = new Set(['defog', 'courtchange']);

/**
 * Victim-aware hazard cost for the side the hazards lie on, capped at
 * `hazardCap`. Exported for direct testing.
 */
export function hazardCost(side: Side, battle: Battle, exclude?: ReadonlySet<Pokemon>): number {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  let cost = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0 || exclude?.has(pokemon)) continue;
    cost += bodyWeight * hazardEntryFraction(pokemon, side, battle) * EVAL_WEIGHTS.hazardEntries;
  }
  return Math.min(cost, EVAL_WEIGHTS.hazardCap);
}

/** Which hazards lie on the side (spikes capped at three layers). */
function hazardLayers(side: Side): { hasRocks: boolean; spikesLayers: number; hasToxicSpikes: boolean; hasWeb: boolean } {
  const hasRocks = !!side.sideConditions['stealthrock'];
  const spikesLayers = Math.min(side.sideConditions['spikes']?.layers ?? 0, 3);
  const hasToxicSpikes = !!side.sideConditions['toxicspikes'];
  const hasWeb = !!side.sideConditions['stickyweb'];
  return { hasRocks, spikesLayers, hasToxicSpikes, hasWeb };
}

/**
 * Grounded for entry pricing: the sim's grounding with the bench-Levitate
 * correction (the sim ignores an INACTIVE mon's ability, but entry pricing
 * is about the moment it becomes active).
 */
function entryGrounded(pokemon: Pokemon, battle: Battle): boolean {
  const gravityActive = !!battle.field.pseudoWeather['gravity'];
  return !!pokemon.isGrounded() &&
    !(!pokemon.isActive && !gravityActive && pokemon.ability === 'levitate');
}

/**
 * The entry-damage fraction THIS mon pays to switch into its side's
 * hazards — the shared per-mon term behind hazardCost and the matchup
 * entry discount. 0 for Heavy-Duty Boots and Magic Guard; ground-bound
 * hazards use the sim's grounding (with the bench-Levitate correction:
 * the sim ignores an INACTIVE mon's ability, but entry pricing is about
 * the moment it becomes active); Toxic Spikes immunity is dex-typed.
 */
export function hazardEntryFraction(pokemon: Pokemon, side: Side, battle: Battle): number {
  const { hasRocks, spikesLayers, hasToxicSpikes, hasWeb } = hazardLayers(side);
  if (!hasRocks && !spikesLayers && !hasToxicSpikes && !hasWeb) return 0;
  if (pokemon.item === 'heavydutyboots' || pokemon.ability === 'magicguard') return 0;

  const grounded = entryGrounded(pokemon, battle);
  let fraction = 0;
  if (hasRocks) {
    fraction += 0.125 * Math.pow(2, battle.dex.getEffectiveness('Rock', pokemon.types));
  }
  if (grounded) {
    if (spikesLayers) fraction += [0, 1 / 8, 1 / 6, 1 / 4][spikesLayers];
    if (hasToxicSpikes && battle.dex.getImmunity('psn', pokemon.types)) {
      fraction += 0.06; // priced as a slice of the psn/tox status cost
    }
    if (hasWeb) fraction += 0.04;
  }
  return fraction;
}

/**
 * Living BENCHED mons that cannot survive re-entry through their own side's
 * hazards (hp fraction ≤ hazardEntryFraction — Boots, Magic Guard, the
 * bench-Levitate correction, and typed immunities all inherit from that
 * shared term). Empty while the side keeps a living removal carrier: a
 * piece that can wait for removal is not finished, and removal's own
 * option value is already priced by hazardRemovalEquity. Exported for
 * direct testing.
 */
export function strandedMons(side: Side, battle: Battle): Set<Pokemon> {
  const stranded = new Set<Pokemon>();
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    for (const slot of usableSlots(pokemon)) {
      if (OWN_SIDE_REMOVAL_MOVES.has(slot.id) || BOTH_SIDES_REMOVAL_MOVES.has(slot.id)) {
        return stranded;
      }
    }
  }
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0 || pokemon.isActive) continue;
    const fraction = hazardEntryFraction(pokemon, side, battle);
    if (fraction > 0 && pokemon.hp / pokemon.maxhp <= fraction) stranded.add(pokemon);
  }
  return stranded;
}

/**
 * The OPTION VALUE a side's living hazard removers hold over the board
 * state: the best net hazard-cost change any of them could buy by clicking
 * their removal move, floored at zero (a net-negative option — Defog that
 * would also destroy the side's own more-valuable hazards on the opponent's
 * board — is simply never exercised), then tempo-discounted. Own-side-only
 * moves (Rapid Spin, Mortal Spin, Tidy Up) net the side's full relief;
 * both-sides moves (Defog, Court Change) net relief MINUS the side's own
 * hazards' worth over there. Exported for direct testing.
 */
export function hazardRemovalEquity(side: Side, battle: Battle): number {
  const own = hazardCost(side, battle);
  if (own <= 0) return 0;
  let best = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    for (const slot of usableSlots(pokemon)) {
      if (OWN_SIDE_REMOVAL_MOVES.has(slot.id)) {
        best = Math.max(best, own);
      } else if (BOTH_SIDES_REMOVAL_MOVES.has(slot.id)) {
        best = Math.max(best, own - hazardCost(side.foe, battle));
      }
    }
  }
  return Math.max(0, best) * EVAL_WEIGHTS.hazardRemovalDiscount;
}
