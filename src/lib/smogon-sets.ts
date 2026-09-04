import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Smogon } from '@pkmn/smogon';
import type { ID } from '@pkmn/data';
import {
  toId, type PokemonSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions,
} from '@fulllifegames/replay-core';
import { ouFallbackFormat } from './smogon/format-fallback';
import { withSmogonFallback, type SmogonFetch } from './smogon/hosts';

export type {
  PokemonSetAssumption, SetAssumption, SetSpreadAssumption, SmogonSetAssumptions,
} from '@fulllifegames/replay-core';
export { getSpeciesSetAssumption } from '@fulllifegames/replay-core';

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

/**
 * fetch as a free function: @pkmn/smogon calls `this.fetch(url)`, and a
 * browser's window.fetch throws "Illegal invocation" on a foreign `this`
 * (round 33: the set assumptions had never loaded in any browser).
 */
const boundFetch: SmogonFetch = (input, init) => fetch(input, init);

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
    const fetcher = withSmogonFallback((params.fetcher ?? boundFetch) as SmogonFetch);
    const smogon = new Smogon(fetcher as unknown as SmogonFetcher, true);
    const detail = sourceDetail(format);
    const pokemon: Record<string, PokemonSetAssumption> = {};
    const errors: string[] = [];

    await Promise.all(species.map(async name => {
      try {
        const sets = await smogon.sets(gen, name, format as ID);
        const first = sets[0];
        if (!first) return; // No published set for this species: absence, not failure.
        const entry = normalizeSet(name, first as AssumptionSet, detail);
        const alternatives = sets.slice(1, 8)
          .map(set => normalizeSet(name, set as AssumptionSet, detail));
        if (alternatives.length > 0) entry.alternatives = alternatives;
        pokemon[toId(name)] = entry;
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));

    // Every species failed: the source is down, not the species absent.
    if (errors.length === species.length) throw new Error(`Smogon sets unavailable: ${errors[0]}`);
    return Object.keys(pokemon).length > 0 ? {
      format,
      source: 'https://data.pkmn.cc',
      pokemon,
      ...(errors.length > 0 ? { errors } : {}),
    } : null;
  })();

  cache.set(cacheKey, request);
  // A failure is never cached: the next load retries.
  request.catch(() => {
    if (cache.get(cacheKey) === request) cache.delete(cacheKey);
  });
  return request;
}
