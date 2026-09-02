import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Smogon } from '@pkmn/smogon';
import type { ID } from '@pkmn/data';
import { toId } from './ids';
import { ouFallbackFormat } from './smogon/format-fallback';

export interface SetAssumption {
  value: string;
  sourceDetail: string;
}

export interface SetSpreadAssumption extends SetAssumption {
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

export interface PokemonSetAssumption {
  species: string;
  sourceDetail: string;
  ability?: SetAssumption;
  item?: SetAssumption;
  moves: SetAssumption[];
  spread?: SetSpreadAssumption;
  /**
   * The species' OTHER published sets (this entry is the first). Coherent-set
   * selection scores all of them against revealed evidence — curated sets are
   * internally coherent by construction, unlike marginal assembly.
   */
  alternatives?: PokemonSetAssumption[];
}

export interface SmogonSetAssumptions {
  format: string;
  source: string;
  pokemon: Record<string, PokemonSetAssumption>;
}

type SmogonFetcher = ConstructorParameters<typeof Smogon>[0];
type AssumptionSet = {
  ability?: string;
  item?: string;
  moves?: string[];
  nature?: string;
  evs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
};

const gens = new Generations(Dex);
const cache = new Map<string, Promise<SmogonSetAssumptions | null>>();

function genFromFormat(formatId: string | undefined): number {
  const match = toId(formatId || 'gen9ou').match(/^gen(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 9;
}

function normalizeFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou');
  if (id.includes('nationaldexdoubles')) return 'gen9nationaldexdoubles';
  return ouFallbackFormat(id);
}

function sourceDetail(format: string): string {
  return `Smogon sets ${format}`;
}

function assumption(value: string | undefined, detail: string): SetAssumption | undefined {
  return value ? { value, sourceDetail: detail } : undefined;
}

function evsWithDefaults(evs: NonNullable<AssumptionSet['evs']>): SetSpreadAssumption['evs'] {
  return {
    hp: evs.hp ?? 0,
    atk: evs.atk ?? 0,
    def: evs.def ?? 0,
    spa: evs.spa ?? 0,
    spd: evs.spd ?? 0,
    spe: evs.spe ?? 0,
  };
}

function spreadAssumption(set: AssumptionSet, detail: string): SetSpreadAssumption | undefined {
  if (!set.nature && !set.evs) return undefined;
  const nature = set.nature || 'Hardy';
  const evs = evsWithDefaults(set.evs ?? {});
  return {
    value: `${nature}:${evs.hp}/${evs.atk}/${evs.def}/${evs.spa}/${evs.spd}/${evs.spe}`,
    nature,
    evs,
    sourceDetail: detail,
  };
}

function normalizeSet(
  species: string,
  set: AssumptionSet,
  detail: string,
): PokemonSetAssumption {
  return {
    species,
    sourceDetail: detail,
    ability: assumption(set.ability, detail),
    item: assumption(set.item, detail),
    moves: (set.moves ?? []).slice(0, 4).map(move => ({ value: move, sourceDetail: detail })),
    spread: spreadAssumption(set, detail),
  };
}

export async function fetchSmogonSetAssumptions(params: {
  formatId: string | undefined;
  species: string[];
  fetcher?: SmogonFetcher;
}): Promise<SmogonSetAssumptions | null> {
  const format = normalizeFormat(params.formatId);
  const species = [...new Set(params.species.filter(Boolean).map(name => name.trim()))];
  if (species.length === 0) return null;

  const cacheKey = `${format}:${species.map(toId).sort().join(',')}:${params.fetcher ? 'custom' : 'global'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    const gen = gens.get(genFromFormat(format));
    const smogon = new Smogon(params.fetcher ?? fetch, true);
    const detail = sourceDetail(format);
    const pokemon: Record<string, PokemonSetAssumption> = {};

    await Promise.all(species.map(async name => {
      try {
        const sets = await smogon.sets(gen, name, format as ID);
        const first = sets[0];
        if (!first) return;
        const entry = normalizeSet(name, first as AssumptionSet, detail);
        const alternatives = sets.slice(1, 8)
          .map(set => normalizeSet(name, set as AssumptionSet, detail));
        if (alternatives.length > 0) entry.alternatives = alternatives;
        pokemon[toId(name)] = entry;
      } catch {
        // A missing Smogon set should never block replay loading.
      }
    }));

    return Object.keys(pokemon).length > 0 ? {
      format,
      source: 'https://data.pkmn.cc',
      pokemon,
    } : null;
  })();

  cache.set(cacheKey, request);
  return request;
}

export function getSpeciesSetAssumption(
  assumptions: SmogonSetAssumptions | null | undefined,
  species: string,
): PokemonSetAssumption | undefined {
  if (!assumptions) return undefined;
  return assumptions.pokemon[toId(species)] ??
    Object.values(assumptions.pokemon).find(entry => toId(entry.species) === toId(species));
}
