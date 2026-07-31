import { Generations, type GenerationNum } from '@pkmn/data';
import { Dex } from '@pkmn/dex';

/**
 * Legal option pools for dropdowns. Heavy dex/learnset data — this module is
 * only ever loaded via dynamic import() so it stays out of the entry chunk.
 */
const gens = new Generations(Dex);
const movePoolCache = new Map<string, Promise<string[]>>();

export const NATURES: readonly string[] = [
  'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm', 'Careful', 'Docile', 'Gentle', 'Hardy',
  'Hasty', 'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild', 'Modest', 'Naive', 'Naughty',
  'Quiet', 'Quirky', 'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid',
];

function clampGen(gen: number): GenerationNum {
  return Math.min(9, Math.max(1, Math.round(gen))) as GenerationNum;
}

function allGenMoves(gen: GenerationNum): string[] {
  return [...gens.get(gen).moves].map(move => move.name).sort((a, b) => a.localeCompare(b));
}

export function getMovePool(species: string, gen: number): Promise<string[]> {
  const generation = gens.get(clampGen(gen));
  const cacheKey = `${generation.num}:${species.toLowerCase()}`;
  const cached = movePoolCache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    const names = new Set<string>();
    const genPrefix = String(generation.num);
    let current = generation.species.get(species);
    while (current) {
      const learnset = await generation.learnsets.get(current.id);
      for (const [moveId, sources] of Object.entries(learnset?.learnset ?? {})) {
        if (!sources.some(code => code.startsWith(genPrefix))) continue;
        const move = generation.moves.get(moveId);
        if (move) names.add(move.name);
      }
      current = current.prevo ? generation.species.get(current.prevo) : undefined;
    }
    // Unknown species or missing learnset: offer everything rather than block.
    if (names.size === 0) return allGenMoves(generation.num);
    return [...names].sort((a, b) => a.localeCompare(b));
  })();

  movePoolCache.set(cacheKey, request);
  return request;
}

export function getItemPool(gen: number): string[] {
  const generation = gens.get(clampGen(gen));
  if (generation.num < 2) return [];
  return [...generation.items].map(item => item.name).sort((a, b) => a.localeCompare(b));
}

export function getAbilityPool(species: string, gen: number): string[] {
  const generation = gens.get(clampGen(gen));
  if (generation.num < 3) return [];
  const entry = generation.species.get(species);
  if (!entry) return [];
  return Object.values(entry.abilities).filter((name): name is string => !!name);
}

export function getTeraTypePool(gen: number): string[] {
  if (clampGen(gen) < 9) return [];
  const names = [...gens.get(9).types]
    .map(type => type.name)
    .filter(name => name !== '???');
  if (!names.includes('Stellar')) names.push('Stellar');
  return names.sort((a, b) => a.localeCompare(b));
}
