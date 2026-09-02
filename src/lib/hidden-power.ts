import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { getSpeciesUsageStats } from './smogon/usage-lookup';
import type { SmogonUsageStats } from './smogon/stats-types';
import type { HiddenPowerEvidence } from '../types';
import { toId } from './ids';

/**
 * Typeless "Hidden Power" resolution (round 2, agenda item ⑤): the replay
 * only ever shows the generic name, and the sim then runs the IV-default
 * type (31s = Dark) — the 648453 t13 mon really carried HP Ice. Evidence
 * from effectiveness markers filters the candidates, usage ranks the
 * survivors, explicit knowledge (hpType / custom IVs / typed names) wins.
 */

export const HP_TYPES = [
  'Bug', 'Dark', 'Dragon', 'Electric', 'Fighting', 'Fire', 'Flying', 'Ghost',
  'Grass', 'Ground', 'Ice', 'Poison', 'Psychic', 'Rock', 'Steel', 'Water',
] as const;

type Marker = HiddenPowerEvidence['marker'];

function markerFor(dex: typeof Dex, type: string, defenderSpecies: string): Marker | null {
  const species = dex.species.get(defenderSpecies);
  if (!species.exists) return null;
  const targetTypes = species.types;
  if (!dex.getImmunity(type, targetTypes as never)) return 'immune';
  const effectiveness = dex.getEffectiveness(type, targetTypes as never);
  return effectiveness > 0 ? 'super' : effectiveness < 0 ? 'resisted' : 'neutral';
}

export function resolveHiddenPowerType(
  evidence: HiddenPowerEvidence[],
  usageStats: SmogonUsageStats | null | undefined,
  species: string,
  gen: number,
): string | null {
  const stats = getSpeciesUsageStats(species, usageStats);
  const dex = Dex.forGen(Math.min(9, Math.max(2, gen)));
  const variants = (stats?.moves ?? [])
    .filter(move => toId(move.value).startsWith('hiddenpower') && toId(move.value) !== 'hiddenpower')
    .map(move => {
      // Usage payloads carry raw ids ("hiddenpowerice") — display through
      // the dex so the substituted slot reads like a real move name.
      const dexMove = dex.moves.get(toId(move.value));
      return {
        display: dexMove.exists ? dexMove.name : move.value,
        type: HP_TYPES.find(candidate => toId(move.value) === `hiddenpower${toId(candidate)}`),
        probability: move.probability,
      };
    })
    .filter((variant): variant is { display: string; type: (typeof HP_TYPES)[number]; probability: number } => !!variant.type)
    .sort((a, b) => b.probability - a.probability);
  if (variants.length === 0) return null;
  const speciesId = toId(species);
  const mine = evidence.filter(entry => toId(entry.attackerSpecies) === speciesId);
  const fits = (type: string) =>
    mine.every(entry => markerFor(dex as typeof Dex, type, entry.defenderSpecies) === entry.marker);
  const surviving = variants.filter(variant => fits(variant.type));
  // Empty intersection: ability-faked markers (Levitate family) can poison
  // the filter — fall back to usage alone rather than to nothing.
  return (surviving[0] ?? variants[0]).display;
}

/**
 * The typed Hidden Power variant a built set carries ('hiddenpowerice'), or
 * null. Damage fitters need it: the protocol only ever records the generic
 * 'hiddenpower', and calculating that id runs the IV-default type — fitting
 * spreads under ×1 for a hit the sim then plays at ×4 (653785 Dragonite).
 */
export function typedHiddenPowerId(moves: string[]): string | null {
  for (const move of moves) {
    const id = toId(move);
    if (id.startsWith('hiddenpower') && id !== 'hiddenpower') return id;
  }
  return null;
}

/** Builder post-pass: substitute ONLY the exactly-typeless slot; explicit
 * knowledge (hpType, deliberate IVs, typed names) is never overridden. */
export function withHiddenPowerType(
  set: PokemonSet,
  evidence: HiddenPowerEvidence[],
  usageStats: SmogonUsageStats | null | undefined,
  gen: number,
): PokemonSet {
  const index = set.moves.findIndex(move => toId(move) === 'hiddenpower');
  if (index < 0) return set;
  if (set.hpType) return set;
  const defaultIvs = !set.ivs || Object.values(set.ivs).every(value => value === 31);
  if (!defaultIvs) return set;
  const resolved = resolveHiddenPowerType(
    evidence.filter(entry => toId(entry.attackerSpecies) === toId(set.species)), usageStats, set.species, gen);
  if (!resolved) return set;
  const moves = [...set.moves];
  moves[index] = resolved;
  return { ...set, moves };
}
