import { Smogon } from '@pkmn/smogon';
import type { ID } from '@pkmn/data';
import {
  generatesTeam, generationsFor, toId, type PokemonSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions as PublishedSets,
} from '@fulllifegames/replay-core';
import { championsSetsFormat, nationalDexDoublesFormat, ouFallbackFormat, vgcYearFormat } from './smogon/format-fallback';
import { fetcherKey } from './smogon/fetcher-key';
import { withSmogonFallback, type SmogonFetch } from './smogon/hosts';
import { fetchRandomSets, type RandomSetFile } from './random-sets';

export type SmogonSetAssumptions = PublishedSets & { randomSets?: RandomSetFile };

type SmogonFetcher = ConstructorParameters<typeof Smogon>[0];
type AssumptionSet = {
  name?: string;
  ability?: string;
  item?: string;
  moves?: string[];
  nature?: string;
  evs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  /** @pkmn/smogon's first IV option, completed for a typed Hidden Power (fixIVs). */
  ivs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
};

type RawSet = { moves?: (string | string[])[]; item?: string | string[] };
type RawSetsFile = Record<string, Record<string, RawSet | undefined> | undefined>;

const gens = generationsFor('');
const cache = new Map<string, Promise<SmogonSetAssumptions | null>>();

// A free function: @pkmn/smogon calls `this.fetch(url)`; window.fetch throws "Illegal invocation" on a foreign `this`.
const boundFetch: SmogonFetch = (input, init) => fetch(input, init);

function genFromFormat(formatId: string | undefined): number {
  const match = toId(formatId || 'gen9ou').match(/^gen(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 9;
}

// VGC reads its year's VGC file, never the Doubles OU analyses; other Champions formats read their own, no generation.
function normalizeFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou');
  return nationalDexDoublesFormat(id) ?? vgcYearFormat(id) ?? championsSetsFormat(id) ?? ouFallbackFormat(id);
}

function sourceDetail(format: string): string {
  return `Smogon sets ${format}`;
}

// The generation's Ubers file (Doubles Ubers for doubles) holds a banned species' set; VGC and Champions take none.
function fallbackFormat(format: string): string | null {
  const gen = format.match(/^gen\d+/)?.[0];
  if (!gen || format.includes('vgc')) return null;
  const fallback = format.includes('doubles') ? `${gen}doublesubers` : `${gen}ubers`;
  return fallback === format ? null : fallback;
}

// A missing file reads as no sets: the fetch wrapper hands a 404 through and @pkmn/smogon then calls json() on it.
async function setsFrom(smogon: Smogon, gen: ReturnType<typeof gens.get>, name: string, format: string): Promise<AssumptionSet[]> {
  try {
    return await smogon.sets(gen, name, format as ID) as AssumptionSet[];
  } catch (error) {
    if (error instanceof Error && /404|Unexpected token|JSON/.test(error.message)) return [];
    throw error;
  }
}

// A 404 reads as an empty file before json() runs (browsers word its parse error differently); one fetch and parse per
// file for all species of a request, as @pkmn/smogon keeps a file once its response arrived. A failure is not kept.
function keepingSetsFiles(fetcher: SmogonFetch, files: RawSetsFile[]): SmogonFetch {
  const shared = new Map<string, Promise<Response>>();
  const read = async (input: string, init?: RequestInit): Promise<Response> => {
    const response = await fetcher(input, init);
    if (response.status === 404) return { ok: false, status: 404, json: async () => ({}) } as Response;
    let file: Promise<RawSetsFile> | null = null;
    return {
      ok: response.ok,
      status: response.status,
      json: () => (file ??= (response.json() as Promise<RawSetsFile>).then(parsed => {
        files.push(parsed);
        return parsed;
      })),
    } as Response;
  };
  return (input, init) => {
    if (!/\/sets\/[^/]+\.json$/.test(input)) return fetcher(input, init);
    let response = shared.get(input);
    if (!response) {
      response = read(input, init);
      shared.set(input, response);
      response.catch(() => shared.delete(input));
    }
    return response;
  };
}

function publishedSet(files: RawSetsFile[], set: AssumptionSet): RawSet | null {
  const moves = set.moves ?? [];
  if (!set.name) return null;
  for (const file of files) {
    for (const sets of Object.values(file)) {
      const published = sets?.[set.name];
      const slots = published?.moves;
      if (slots?.length === moves.length &&
        slots.every((slot, index) => (Array.isArray(slot) ? slot[0] : slot) === moves[index])) return published ?? null;
    }
  }
  return null;
}

function slotAssumption(value: string, slot: string | string[] | undefined, detail: string): SetAssumption {
  return Array.isArray(slot) && slot.length > 1
    ? { value, sourceDetail: detail, options: [...slot] }
    : { value, sourceDetail: detail };
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
  files: RawSetsFile[],
): PokemonSetAssumption {
  const published = publishedSet(files, set);
  return {
    species,
    sourceDetail: detail,
    ability: assumption(set.ability, detail),
    item: set.item ? slotAssumption(set.item, published?.item, detail) : undefined,
    moves: (set.moves ?? []).slice(0, 4).map((move, index) => slotAssumption(move, published?.moves?.[index], detail)),
    spread: spreadAssumption(set, detail),
    ...(set.ivs && Object.keys(set.ivs).length > 0 ? { ivs: { ...set.ivs } } : {}),
  };
}

// A failed fetch leaves its message in `errors`; the game plays as before.
async function randomSetsOf(formatId: string | undefined, fetcher: SmogonFetch, errors: string[]): Promise<RandomSetFile | null> {
  const id = toId(formatId || '');
  if (!generatesTeam(id)) return null;
  try {
    return await fetchRandomSets(id, fetcher);
  } catch (error) {
    errors.push(`random sets: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function fetchSmogonSetAssumptions(params: {
  formatId: string | undefined;
  species: string[];
  fetcher?: SmogonFetcher;
}): Promise<SmogonSetAssumptions | null> {
  const format = normalizeFormat(params.formatId);
  const species = [...new Set(params.species.filter(Boolean).map(name => name.trim()))];
  if (species.length === 0) return null;

  const cacheKey = `${format}:${species.map(toId).sort().join(',')}:${fetcherKey(params.fetcher)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    const gen = gens.get(genFromFormat(format));
    const files: RawSetsFile[] = [];
    const fetcher = keepingSetsFiles(withSmogonFallback((params.fetcher ?? boundFetch) as SmogonFetch), files);
    const smogon = new Smogon(fetcher as unknown as SmogonFetcher, true);
    const fallback = fallbackFormat(format);
    const pokemon: Record<string, PokemonSetAssumption> = {};
    const errors: string[] = [];
    const formats = new Set<string>();

    await Promise.all(species.map(async name => {
      try {
        let sourceFormat = format;
        let sets = await setsFrom(smogon, gen, name, format);
        if (sets.length === 0 && fallback) {
          sets = await setsFrom(smogon, gen, name, fallback);
          sourceFormat = fallback;
        }
        const first = sets[0];
        if (!first) return; // No published set for this species: absence, not failure.
        formats.add(sourceFormat);
        const detail = sourceDetail(sourceFormat);
        const entry = normalizeSet(name, first, detail, files);
        const alternatives = sets.slice(1, 8).map(set => normalizeSet(name, set, detail, files));
        if (alternatives.length > 0) entry.alternatives = alternatives;
        pokemon[toId(name)] = entry;
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));

    if (errors.length === species.length) throw new Error(`Smogon sets unavailable: ${errors[0]}`);
    // The Smogon hosts' wrapper does not apply (the file is not on the mirror): fetchRandomSets tries its own hosts.
    const randomSets = await randomSetsOf(params.formatId, (params.fetcher ?? boundFetch) as SmogonFetch, errors);
    return Object.keys(pokemon).length > 0 || randomSets ? {
      format,
      source: 'https://data.pkmn.cc',
      pokemon,
      ...(errors.length > 0 ? { errors } : {}),
      formats: [format, ...[...formats].filter(entry => entry !== format)],
      ...(randomSets ? { randomSets } : {}),
    } : null;
  })();

  cache.set(cacheKey, request);
  request.catch(() => {
    if (cache.get(cacheKey) === request) cache.delete(cacheKey);
  });
  return request;
}
