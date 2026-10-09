import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Smogon } from '@pkmn/smogon';
import type { ID } from '@pkmn/data';
import {
  toId, type PokemonSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions,
} from '@fulllifegames/replay-core';
import { ouFallbackFormat, vgcYearFormat } from './smogon/format-fallback';
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
  /** @pkmn/smogon's first IV option, completed for a typed Hidden Power (fixIVs). */
  ivs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
};

/** A published sets file: species, then set name; a move slot or the item is one name or its options. */
type RawSet = { moves?: (string | string[])[]; item?: string | string[] };
type RawSetsFile = Record<string, Record<string, RawSet | undefined> | undefined>;

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

/**
 * The sets file a format reads. Round 66 (T142): VGC reads the VGC file of
 * its year (gen9vgc2025, gen9championsvgc2026) and never the Doubles OU
 * analyses, another format's sets; a year without a file leaves the guess
 * to the usage file.
 */
function normalizeFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou');
  if (id.includes('nationaldexdoubles')) return 'gen9nationaldexdoubles';
  return vgcYearFormat(id) ?? ouFallbackFormat(id);
}

function sourceDetail(format: string): string {
  return `Smogon sets ${format}`;
}

/** The generation's Ubers file (Doubles Ubers for doubles): where a banned species' set lives. VGC takes none (T142). */
function fallbackFormat(format: string): string | null {
  const gen = format.match(/^gen\d+/)?.[0];
  if (!gen || format.includes('vgc')) return null;
  const fallback = format.includes('doubles') ? `${gen}doublesubers` : `${gen}ubers`;
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
 * A missing sets file (404) reads as an empty one before json() runs: the
 * browsers word the parse error of a 404 page differently, and WebKit's
 * "The string did not match the expected pattern." passed no error filter
 * (round 66 review).
 */
function keepingSetsFiles(fetcher: SmogonFetch, files: RawSetsFile[]): SmogonFetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!/\/sets\/[^/]+\.json$/.test(input)) return response;
    if (response.status === 404) return { ok: false, status: 404, json: async () => ({}) } as Response;
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

/** The published set behind one flattened set: same set name, same first options. */
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

/** A move or the item with its published slot: `options` when the slot lists more than one. */
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
    // Round 64 (T120, R1): the item slot as published ("Leftovers / Metal Coat").
    item: set.item ? slotAssumption(set.item, published?.item, detail) : undefined,
    moves: (set.moves ?? []).slice(0, 4).map((move, index) => slotAssumption(move, published?.moves?.[index], detail)),
    spread: spreadAssumption(set, detail),
    // Round 64 (T122): the IVs as published (Speed 0, Attack 0).
    ...(set.ivs && Object.keys(set.ivs).length > 0 ? { ivs: { ...set.ivs } } : {}),
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
