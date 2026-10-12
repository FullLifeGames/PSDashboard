import { Generations, type GenerationNum } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Dex as SimDex } from '@pkmn/sim';
import { evBudget } from '@fulllifegames/replay-core';

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

/**
 * Pokémon Champions plays on a simulator mod whose dex the generation
 * wrapper cannot read (it keeps 876 of 1517 species and no Mega Stone, and
 * loses Aegislash), so its pools come from the mod itself.
 */
const isChampions = (format: string | undefined): boolean => !!format && evBudget(format).statPoints;
const championsDex = () => SimDex.mod('champions');

/** Loads what a format's pools read before the first pool is asked (the Champions mod, nothing else). */
export async function prepareFormat(format: string): Promise<void> {
  if (!isChampions(format)) return;
  const { loadSimMods } = await import('./lazy/branch-engine');
  await loadSimMods(format);
}

/** The total EV limit the simulator's team validator enforces in a format (`null`: none, or the format is unknown). */
export function getEvLimit(format: string): number | null {
  const entry = SimDex.formats.get(format.split('@@@')[0]);
  return entry.exists ? SimDex.formats.getRuleTable(entry).evLimit : null;
}

const toSimId = (name: string): string => SimDex.toID(name);

async function getChampionsMovePool(species: string): Promise<string[]> {
  const dex = championsDex();
  const names = new Set<string>();
  const entry = dex.species.get(species);
  // A forme without a learnset of its own learns what its base forme learns.
  for (const id of new Set([entry.id, toSimId(entry.changesFrom ?? entry.baseSpecies)])) {
    for (const [moveId, sources] of Object.entries((await dex.learnsets.get(id)).learnset ?? {})) {
      if (sources.some(code => code.startsWith('9'))) names.add(dex.moves.get(moveId).name);
    }
    if (names.size > 0) break;
  }
  // Unknown species or no Generation 9 learnset (Past in the mod): offer everything rather than block.
  const pool = names.size > 0 ? [...names] : [...dex.moves.all()].filter(move => !move.isNonstandard).map(move => move.name);
  return pool.sort((a, b) => a.localeCompare(b));
}

function clampGen(gen: number): GenerationNum {
  return Math.min(9, Math.max(1, Math.round(gen))) as GenerationNum;
}

function allGenMoves(gen: GenerationNum): string[] {
  return [...gens.get(gen).moves].map(move => move.name).sort((a, b) => a.localeCompare(b));
}

export function getMovePool(species: string, gen: number, format?: string): Promise<string[]> {
  const generation = gens.get(clampGen(gen));
  const champions = isChampions(format);
  const cacheKey = `${champions ? 'champions' : generation.num}:${species.toLowerCase()}`;
  const cached = movePoolCache.get(cacheKey);
  if (cached) return cached;
  if (champions) {
    const pool = getChampionsMovePool(species);
    movePoolCache.set(cacheKey, pool);
    return pool;
  }

  const request = (async () => {
    const names = new Set<string>();
    const genPrefix = String(generation.num);
    const entry = generation.species.get(species);
    // The library walks prevos and the forme a Pokémon changes from (a forme's
    // own learnset holds only its signature moves: Rotom-Wash, Hydro Pump).
    const learnsets = entry ? generation.learnsets.all(entry) : [];
    for await (const learnset of learnsets) {
      for (const [moveId, sources] of Object.entries(learnset.learnset ?? {})) {
        if (!sources.some(code => code.startsWith(genPrefix))) continue;
        const move = generation.moves.get(moveId);
        if (move) names.add(move.name);
      }
    }
    // Unknown species or missing learnset: offer everything rather than block.
    if (names.size === 0) return allGenMoves(generation.num);
    return [...names].sort((a, b) => a.localeCompare(b));
  })();

  movePoolCache.set(cacheKey, request);
  return request;
}

export function getItemPool(gen: number, format?: string): string[] {
  if (isChampions(format)) {
    return [...championsDex().items.all()].filter(item => !item.isNonstandard).map(item => item.name).sort((a, b) => a.localeCompare(b));
  }
  const generation = gens.get(clampGen(gen));
  if (generation.num < 2) return [];
  return [...generation.items].map(item => item.name).sort((a, b) => a.localeCompare(b));
}

export function getAbilityPool(species: string, gen: number, format?: string): string[] {
  if (isChampions(format)) {
    const entry = championsDex().species.get(species);
    return entry.exists ? Object.values(entry.abilities).filter((name): name is string => !!name) : [];
  }
  const generation = gens.get(clampGen(gen));
  if (generation.num < 3) return [];
  const entry = generation.species.get(species);
  if (!entry) return [];
  return Object.values(entry.abilities).filter((name): name is string => !!name);
}

export function getTeraTypePool(gen: number, format?: string): string[] {
  if (isChampions(format)) return [];
  if (clampGen(gen) < 9) return [];
  const names = [...gens.get(9).types]
    .map(type => type.name)
    .filter(name => name !== '???');
  if (!names.includes('Stellar')) names.push('Stellar');
  return names.sort((a, b) => a.localeCompare(b));
}
