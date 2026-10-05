import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Smogon } from '@pkmn/smogon';
import type { ID } from '@pkmn/data';
import {
  toId, type PokemonSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions,
} from '@fulllifegames/replay-core';
import { ouFallbackFormat } from './smogon/format-fallback';
import { fetcherKey } from './smogon/fetcher-key';
import { withSmogonFallback, type SmogonFetch } from './smogon/hosts';

export type {
  PokemonSetAssumption, SetAssumption, SetSpreadAssumption, SmogonSetAssumptions,
} from '@fulllifegames/replay-core';
export { getSpeciesSetAssumption } from '@fulllifegames/replay-core';

type SmogonFetcher = ConstructorParameters<typeof Smogon>[0];
type AssumptionSet = {
  name?: string;
  ability?: string;
  item?: string;
  moves?: string[];
  nature?: string;
  evs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
};

/** A published sets file: species, then set name; a move slot is one name or its options. */
type RawSetsFile = Record<string, Record<string, { moves?: (string | string[])[] } | undefined> | undefined>;

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

/** The generation's Ubers file (Doubles Ubers for doubles and VGC): where a banned species' set lives. */
function fallbackFormat(format: string): string | null {
  const gen = format.match(/^gen\d+/)?.[0];
  if (!gen) return null;
  const fallback = format.includes('doubles') || format.includes('vgc') ? `${gen}doublesubers` : `${gen}ubers`;
  return fallback === format ? null : fallback;
}

/**
 * The species' sets from one file; a file that is not there reads as no
 * sets. The fetch wrapper hands a 404 through, and @pkmn/smogon then
 * calls json() on it: a test fake throws "404", a real 404 page fails to
 * parse. Network failures ("Failed to fetch") stay failures.
 */
async function setsFrom(smogon: Smogon, gen: ReturnType<typeof gens.get>, name: string, format: string): Promise<AssumptionSet[]> {
  try {
    return await smogon.sets(gen, name, format as ID) as AssumptionSet[];
  } catch (error) {
    if (error instanceof Error && /404|Unexpected token|JSON/.test(error.message)) return [];
    throw error;
  }
}

/**
 * Keeps the sets files this request parsed: @pkmn/smogon flattens every
 * move slot to its first option (toSet), the published file still holds
 * them all (round 63, T89: "Heat Wave / Hidden Power Ice" is one slot,
 * Knock Off a fixed one). @pkmn/smogon reads nothing but `json()`.
 */
function keepingSetsFiles(fetcher: SmogonFetch, files: RawSetsFile[]): SmogonFetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!/\/sets\/[^/]+\.json$/.test(input)) return response;
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        const file = await response.json() as RawSetsFile;
        files.push(file);
        return file;
      },
    } as Response;
  };
}

/** The published slots behind one flattened set: same set name, same first options. */
function publishedSlots(files: RawSetsFile[], set: AssumptionSet): (string | string[])[] | null {
  const moves = set.moves ?? [];
  if (!set.name) return null;
  for (const file of files) {
    for (const sets of Object.values(file)) {
      const slots = sets?.[set.name]?.moves;
      if (slots?.length === moves.length &&
        slots.every((slot, index) => (Array.isArray(slot) ? slot[0] : slot) === moves[index])) return slots;
    }
  }
  return null;
}

function moveAssumption(move: string, slot: string | string[] | undefined, detail: string): SetAssumption {
  return Array.isArray(slot) && slot.length > 1
    ? { value: move, sourceDetail: detail, options: [...slot] }
    : { value: move, sourceDetail: detail };
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
  const slots = publishedSlots(files, set);
  return {
    species,
    sourceDetail: detail,
    ability: assumption(set.ability, detail),
    item: assumption(set.item, detail),
    moves: (set.moves ?? []).slice(0, 4).map((move, index) => moveAssumption(move, slots?.[index], detail)),
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

    // Every species failed: the source is down, not the species absent.
    if (errors.length === species.length) throw new Error(`Smogon sets unavailable: ${errors[0]}`);
    return Object.keys(pokemon).length > 0 ? {
      format,
      source: 'https://data.pkmn.cc',
      pokemon,
      ...(errors.length > 0 ? { errors } : {}),
      formats: [format, ...[...formats].filter(entry => entry !== format)],
    } : null;
  })();

  cache.set(cacheKey, request);
  // A failure is never cached: the next load retries.
  request.catch(() => {
    if (cache.get(cacheKey) === request) cache.delete(cacheKey);
  });
  return request;
}
