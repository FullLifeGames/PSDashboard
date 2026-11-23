import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { EVAL_WEIGHTS } from './weights.ts';
import { liveTypes, usableSlots } from './threat.ts';

// Hazards priced by their victims: the per-mon entry fraction, the capped side cost, the stranded bench and the removal option value.

/** Removal moves that clear ONLY the user's side (pure relief). */
// oracle: packages/eval-engine/test/hazard-removal-oracle.spec.ts
export const OWN_SIDE_REMOVAL_MOVES = new Set(['rapidspin', 'mortalspin']);
/** Removal moves that clear (or swap) BOTH sides, so they are double-edged. Tidy Up clears the foe's hazards too. */
// oracle: packages/eval-engine/test/hazard-removal-oracle.spec.ts
export const BOTH_SIDES_REMOVAL_MOVES = new Set(['defog', 'courtchange', 'tidyup']);
/** Defog clears only the target's side before this generation: no relief for its user. */
const DEFOG_CLEARS_OWN_FROM = 6;

/**
 * What a removal move does for its user in a generation: 'own' (clears only the user's side), 'both' (clears or swaps both
 * sides), or null (not a removal move there; Defog before Generation 6 clears the foe's side alone).
 */
export function removalKind(moveId: string, gen: number): 'own' | 'both' | null {
  if (OWN_SIDE_REMOVAL_MOVES.has(moveId)) return 'own';
  if (!BOTH_SIDES_REMOVAL_MOVES.has(moveId)) return null;
  return moveId === 'defog' && gen < DEFOG_CLEARS_OWN_FROM ? null : 'both';
}

/** The hazard cost of the side the hazards lie on, by victim, capped at `hazardCap`. */
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
 * Grounded for entry pricing: the sim's grounding, except that a benched Levitate mon counts as airborne (the sim ignores an
 * inactive mon's ability, but entry pricing is about the moment it becomes active).
 */
function entryGrounded(pokemon: Pokemon, battle: Battle): boolean {
  const gravityActive = !!battle.field.pseudoWeather['gravity'];
  return !!pokemon.isGrounded() &&
    !(!pokemon.isActive && !gravityActive && pokemon.ability === 'levitate');
}

/**
 * The entry-damage fraction THIS mon pays to switch into its side's hazards, the per-mon term behind hazardCost and the matchup
 * entry discount. 0 for Heavy-Duty Boots and Magic Guard; Toxic Spikes immunity is dex-typed.
 */
export function hazardEntryFraction(pokemon: Pokemon, side: Side, battle: Battle): number {
  const { hasRocks, spikesLayers, hasToxicSpikes, hasWeb } = hazardLayers(side);
  if (!hasRocks && !spikesLayers && !hasToxicSpikes && !hasWeb) return 0;
  if (pokemon.item === 'heavydutyboots' || pokemon.ability === 'magicguard') return 0;

  // Grounding follows a Tera click through the sim's isGrounded(); the two typed reads follow it through liveTypes.
  const grounded = entryGrounded(pokemon, battle);
  const types = liveTypes(pokemon);
  let fraction = 0;
  if (hasRocks) {
    fraction += 0.125 * Math.pow(2, battle.dex.getEffectiveness('Rock', types));
  }
  if (grounded) {
    if (spikesLayers) fraction += [0, 1 / 8, 1 / 6, 1 / 4][spikesLayers];
    if (hasToxicSpikes && battle.dex.getImmunity('psn', types)) {
      fraction += 0.06; // priced as a slice of the psn/tox status cost
    }
    if (hasWeb) fraction += 0.04;
  }
  return fraction;
}

/**
 * Living BENCHED mons that cannot survive re-entry through their own side's hazards (hp fraction <= hazardEntryFraction, so
 * Boots, Magic Guard, the bench-Levitate correction and typed immunities all count). Empty while the side keeps a living
 * removal carrier: a piece that can wait for removal is not finished, and hazardRemovalEquity prices the removal.
 */
export function strandedMons(side: Side, battle: Battle): Set<Pokemon> {
  const stranded = new Set<Pokemon>();
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    for (const slot of usableSlots(pokemon)) {
      if (removalKind(slot.id, battle.gen)) {
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
 * The option value a side's living hazard removers hold: the best net hazard-cost change any of them could buy by clicking
 * their removal move, floored at zero (Defog that would destroy more of the side's own hazards on the foe's board is never
 * exercised), then tempo-discounted. Own-side moves net the side's full relief; both-sides moves net relief minus the side's own
 * hazards' worth over there.
 */
export function hazardRemovalEquity(side: Side, battle: Battle): number {
  const own = hazardCost(side, battle);
  if (own <= 0) return 0;
  let best = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    for (const slot of usableSlots(pokemon)) {
      const kind = removalKind(slot.id, battle.gen);
      if (kind === 'own') {
        best = Math.max(best, own);
      } else if (kind === 'both') {
        best = Math.max(best, own - hazardCost(side.foe, battle));
      }
    }
  }
  return Math.max(0, best) * EVAL_WEIGHTS.hazardRemovalDiscount;
}
