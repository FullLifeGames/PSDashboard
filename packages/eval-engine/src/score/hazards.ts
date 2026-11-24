import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { EVAL_WEIGHTS } from './weights.ts';
import { liveTypes, usableSlots } from './threat.ts';

// oracle: packages/eval-engine/test/hazard-removal-oracle.spec.ts
export const OWN_SIDE_REMOVAL_MOVES = new Set(['rapidspin', 'mortalspin']);
/** Removal moves that clear or swap both sides, so they are double-edged (Tidy Up clears the foe's hazards too). */
// oracle: packages/eval-engine/test/hazard-removal-oracle.spec.ts
export const BOTH_SIDES_REMOVAL_MOVES = new Set(['defog', 'courtchange', 'tidyup']);
// Defog clears only the target's side before this generation: no relief for its user.
const DEFOG_CLEARS_OWN_FROM = 6;

/** What a removal move does for its user: 'own' side, 'both' sides, or null (Defog before gen 6 clears the foe's). */
export function removalKind(moveId: string, gen: number): 'own' | 'both' | null {
  if (OWN_SIDE_REMOVAL_MOVES.has(moveId)) return 'own';
  if (!BOTH_SIDES_REMOVAL_MOVES.has(moveId)) return null;
  return moveId === 'defog' && gen < DEFOG_CLEARS_OWN_FROM ? null : 'both';
}

export function hazardCost(side: Side, battle: Battle, exclude?: ReadonlySet<Pokemon>): number {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  let cost = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0 || exclude?.has(pokemon)) continue;
    cost += bodyWeight * hazardEntryFraction(pokemon, side, battle) * EVAL_WEIGHTS.hazardEntries;
  }
  return Math.min(cost, EVAL_WEIGHTS.hazardCap);
}

function hazardLayers(side: Side): { hasRocks: boolean; spikesLayers: number; hasToxicSpikes: boolean; hasWeb: boolean } {
  const hasRocks = !!side.sideConditions['stealthrock'];
  const spikesLayers = Math.min(side.sideConditions['spikes']?.layers ?? 0, 3);
  const hasToxicSpikes = !!side.sideConditions['toxicspikes'];
  const hasWeb = !!side.sideConditions['stickyweb'];
  return { hasRocks, spikesLayers, hasToxicSpikes, hasWeb };
}

// The sim's grounding, except that a benched Levitate mon counts as airborne (the sim ignores an inactive ability,
// but entry pricing is about the moment it becomes active).
function entryGrounded(pokemon: Pokemon, battle: Battle): boolean {
  const gravityActive = !!battle.field.pseudoWeather['gravity'];
  return !!pokemon.isGrounded() &&
    !(!pokemon.isActive && !gravityActive && pokemon.ability === 'levitate');
}

/** The entry damage fraction THIS mon pays to switch into its side's hazards; 0 with Heavy-Duty Boots, Magic Guard. */
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
      fraction += 0.06;
    }
    if (hasWeb) fraction += 0.04;
  }
  return fraction;
}

/** Living benched mons that cannot survive re-entry through hazards; empty while a living removal carrier waits. */
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

/** The best net hazard-cost change a living remover could buy by clicking its removal move, floored at 0. */
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
