import type { PokemonSet } from '@pkmn/sim';
import { getSpeciesUsageStats } from './smogon/usage-lookup.ts';
import type { SmogonUsageStats } from './smogon/stats-types.ts';
import type { HiddenPowerEvidence } from './types.ts';
import { toId } from './ids.ts';
import { rulesDex, type GameRules, type RulesDex } from './rules-dex.ts';


/** The sixteen types a Hidden Power can have. */
export const HP_TYPES = [
  'Bug', 'Dark', 'Dragon', 'Electric', 'Fighting', 'Fire', 'Flying', 'Ghost',
  'Grass', 'Ground', 'Ice', 'Poison', 'Psychic', 'Rock', 'Steel', 'Water',
] as const;

type Marker = HiddenPowerEvidence['marker'];

function markerFor(dex: RulesDex, type: string, defenderSpecies: string): Marker | null {
  const species = dex.species.get(defenderSpecies);
  if (!species.exists) return null;
  const targetTypes = species.types;
  if (!dex.getImmunity(type, targetTypes as never)) return 'immune';
  const effectiveness = dex.getEffectiveness(type, targetTypes as never);
  return effectiveness > 0 ? 'super' : effectiveness < 0 ? 'resisted' : 'neutral';
}

/** The typed Hidden Power name that fits the evidence, ranked by usage; null when usage lists no typed variant. */
export function resolveHiddenPowerType(
  evidence: HiddenPowerEvidence[],
  usageStats: SmogonUsageStats | null | undefined,
  species: string,
  rules: GameRules,
): string | null {
  const stats = getSpeciesUsageStats(species, usageStats);
  const dex = rulesDex(Math.max(2, rules.gen), rules.mod);
  const variants = (stats?.moves ?? [])
    .filter(move => toId(move.value).startsWith('hiddenpower') && toId(move.value) !== 'hiddenpower')
    .map(move => {
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
    mine.every(entry => markerFor(dex, type, entry.defenderSpecies) === entry.marker);
  const surviving = variants.filter(variant => fits(variant.type));
  return (surviving[0] ?? variants[0]).display;
}

/** The typed Hidden Power id a set carries ('hiddenpowerice'), or null; the protocol records only the generic id. */
export function typedHiddenPowerId(moves: string[]): string | null {
  for (const move of moves) {
    const id = toId(move);
    if (id.startsWith('hiddenpower') && id !== 'hiddenpower') return id;
  }
  return null;
}

/** Substitutes only the exactly typeless Hidden Power slot: hpType, deliberate IVs and typed names stay. */
export function withHiddenPowerType(
  set: PokemonSet,
  evidence: HiddenPowerEvidence[],
  usageStats: SmogonUsageStats | null | undefined,
  rules: GameRules,
): PokemonSet {
  const index = set.moves.findIndex(move => toId(move) === 'hiddenpower');
  if (index < 0) return set;
  if (set.hpType) return set;
  const defaultIvs = !set.ivs || Object.values(set.ivs).every(value => value === 31);
  if (!defaultIvs) return set;
  const resolved = resolveHiddenPowerType(
    evidence.filter(entry => toId(entry.attackerSpecies) === toId(set.species)), usageStats, set.species, rules);
  if (!resolved) return set;
  const moves = [...set.moves];
  moves[index] = resolved;
  return { ...set, moves };
}
