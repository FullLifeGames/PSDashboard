import type { PokemonFieldInfo, PokemonMoveInfo } from '../types';

export interface UsageProbability {
  value: string;
  probability: number;
  sourceDetail: string;
}

export interface UsageSpread extends UsageProbability {
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

export interface PokemonUsageStats {
  species: string;
  rawCount: number;
  abilities: UsageProbability[];
  items: UsageProbability[];
  moves: UsageProbability[];
  spreads: UsageSpread[];
}

export interface SmogonUsageStats {
  format: string;
  month: string;
  source: string;
  pokemon: Record<string, PokemonUsageStats>;
}

export interface SpeciesUsageSet {
  ability?: UsageProbability;
  item?: UsageProbability;
  moves: UsageProbability[];
  spread?: UsageSpread;
  sourceDetail: string;
}

interface ChaosPokemonStats {
  'Raw count'?: number;
  Abilities?: Record<string, number | string>;
  Items?: Record<string, number | string>;
  Moves?: Record<string, number | string>;
  Spreads?: Record<string, number | string>;
}

interface ChaosStatsPayload {
  data?: Record<string, ChaosPokemonStats>;
}

interface PkmnPokemonStats {
  count?: number | string;
  abilities?: Record<string, number | string>;
  items?: Record<string, number | string>;
  moves?: Record<string, number | string>;
  spreads?: Record<string, number | string>;
}

interface PkmnStatsPayload {
  pokemon?: Record<string, PkmnPokemonStats>;
}

const usageCache = new Map<string, Promise<SmogonUsageStats | null>>();

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sourceDetail(format: string, month: string): string {
  return `Smogon ${format} ${month}`;
}

function dataPkmnStatsUrl(format: string): string {
  return `https://data.pkmn.cc/stats/${format}.json`;
}

function lookupDisplayName(kind: 'abilities' | 'items' | 'moves' | 'species', value: string): string {
  void kind;
  return value.trim();
}

function roundProbability(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numericEntries(entries: Record<string, number | string> | undefined): [string, number][] {
  if (!entries) return [];
  return Object.entries(entries)
    .map(([value, count]) => [value, typeof count === 'number' ? count : Number.parseFloat(count)] as [string, number])
    .filter(([, count]) => Number.isFinite(count) && count > 0);
}

function numericValue(value: number | string | undefined): number {
  if (value === undefined) return 0;
  const numberValue = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function normalizeUsageValue(value: number, denominator: number, bucketTotal: number): number {
  const looksLikePercent = value <= 100 && bucketTotal <= 450;
  if (looksLikePercent) return roundProbability(value / 100);
  if (denominator <= 0) return 0;
  return roundProbability(value / denominator);
}

function bestDenominator(rawCount: number, rows: [string, number][]): number {
  if (rawCount > 0) return rawCount;
  return rows.reduce((total, [, count]) => total + count, 0);
}

function probabilityRows(
  entries: Record<string, number | string> | undefined,
  rawCount: number,
  detail: string,
  kind: 'abilities' | 'items' | 'moves',
): UsageProbability[] {
  const rows = numericEntries(entries);
  const denominator = bestDenominator(rawCount, rows);
  const bucketTotal = rows.reduce((total, [, count]) => total + count, 0);

  return rows
    .map(([value, count]) => ({
      value: lookupDisplayName(kind, value),
      probability: normalizeUsageValue(count, denominator, bucketTotal),
      sourceDetail: detail,
    }))
    .filter(entry => entry.value && entry.probability > 0 && toId(entry.value) !== 'nothing')
    .sort((a, b) => b.probability - a.probability || a.value.localeCompare(b.value));
}

function normalizeFractionalProbability(value: number): number {
  if (value <= 1) return roundProbability(value);
  if (value <= 100) return roundProbability(value / 100);
  return 1;
}

function fractionalProbabilityRows(
  entries: Record<string, number | string> | undefined,
  detail: string,
  kind: 'abilities' | 'items' | 'moves',
): UsageProbability[] {
  return numericEntries(entries)
    .map(([value, probability]) => ({
      value: lookupDisplayName(kind, value),
      probability: normalizeFractionalProbability(probability),
      sourceDetail: detail,
    }))
    .filter(entry => entry.value && entry.probability > 0 && toId(entry.value) !== 'nothing')
    .sort((a, b) => b.probability - a.probability || a.value.localeCompare(b.value));
}

export function parseSpread(spread: string): Pick<UsageSpread, 'nature' | 'evs'> | null {
  const [nature, evText] = spread.split(':');
  const evs = evText?.split('/').map(part => Number.parseInt(part, 10));
  if (!nature || evs?.length !== 6 || evs.some(ev => !Number.isFinite(ev))) return null;

  return {
    nature,
    evs: {
      hp: evs[0],
      atk: evs[1],
      def: evs[2],
      spa: evs[3],
      spd: evs[4],
      spe: evs[5],
    },
  };
}

function spreadRows(
  entries: Record<string, number | string> | undefined,
  rawCount: number,
  detail: string,
): UsageSpread[] {
  const rows = numericEntries(entries);
  const denominator = bestDenominator(rawCount, rows);
  const bucketTotal = rows.reduce((total, [, count]) => total + count, 0);

  return rows
    .map(([value, count]) => {
      const spread = parseSpread(value);
      if (!spread) return null;
      return {
        value,
        ...spread,
        probability: normalizeUsageValue(count, denominator, bucketTotal),
        sourceDetail: detail,
      };
    })
    .filter((spread): spread is UsageSpread => !!spread && spread.probability > 0)
    .sort((a, b) => b.probability - a.probability || a.value.localeCompare(b.value));
}

function fractionalSpreadRows(
  entries: Record<string, number | string> | undefined,
  detail: string,
): UsageSpread[] {
  return numericEntries(entries)
    .map(([value, probability]) => {
      const spread = parseSpread(value);
      if (!spread) return null;
      return {
        value,
        ...spread,
        probability: normalizeFractionalProbability(probability),
        sourceDetail: detail,
      };
    })
    .filter((spread): spread is UsageSpread => !!spread && spread.probability > 0)
    .sort((a, b) => b.probability - a.probability || a.value.localeCompare(b.value));
}

function parseDataPkmnStats(
  payload: PkmnStatsPayload,
  options: { format: string; month: string },
): SmogonUsageStats {
  const data = payload.pokemon ?? {};
  const detail = sourceDetail(options.format, options.month);
  const pokemon: Record<string, PokemonUsageStats> = {};

  for (const [speciesName, stats] of Object.entries(data)) {
    const species = lookupDisplayName('species', speciesName);

    pokemon[toId(speciesName)] = {
      species,
      rawCount: numericValue(stats.count),
      abilities: fractionalProbabilityRows(stats.abilities, detail, 'abilities'),
      items: fractionalProbabilityRows(stats.items, detail, 'items'),
      moves: fractionalProbabilityRows(stats.moves, detail, 'moves'),
      spreads: fractionalSpreadRows(stats.spreads, detail),
    };
  }

  return {
    format: options.format,
    month: options.month,
    source: dataPkmnStatsUrl(options.format),
    pokemon,
  };
}

export function parseSmogonChaosStats(
  payload: unknown,
  options: { format: string; month: string },
): SmogonUsageStats {
  if ((payload as PkmnStatsPayload)?.pokemon) {
    return parseDataPkmnStats(payload as PkmnStatsPayload, options);
  }

  const data = (payload as ChaosStatsPayload)?.data ?? {};
  const detail = sourceDetail(options.format, options.month);
  const pokemon: Record<string, PokemonUsageStats> = {};

  for (const [speciesName, stats] of Object.entries(data)) {
    const species = lookupDisplayName('species', speciesName);
    const rawCount = stats['Raw count'] ?? 0;

    pokemon[toId(speciesName)] = {
      species,
      rawCount,
      abilities: probabilityRows(stats.Abilities, rawCount, detail, 'abilities'),
      items: probabilityRows(stats.Items, rawCount, detail, 'items'),
      moves: probabilityRows(stats.Moves, rawCount, detail, 'moves'),
      spreads: spreadRows(stats.Spreads, rawCount, detail),
    };
  }

  return {
    format: options.format,
    month: options.month,
    source: `https://www.smogon.com/stats/${options.month}/chaos/${options.format}-0.json`,
    pokemon,
  };
}

export function getSmogonStatsFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou').replace(/^smogtours/, '');
  if (id.includes('nationaldexdoubles')) return 'gen9nationaldexdoubles';
  // VGC: the year-level stats file aggregates all regulations and holds
  // species the Smogon doubles ladder never sees (e.g. Annihilape).
  const vgcYear = id.match(/vgc(\d{4})/);
  if (vgcYear) return `${id.match(/^gen\d+/)?.[0] ?? 'gen9'}vgc${vgcYear[1]}`;
  if (id.includes('doubles') || id.includes('vgc')) return 'gen9doublesou';
  if (/^gen\d+draft/.test(id)) return id.replace(/draft.*$/, 'ou');
  // Custom Game is never in the usage stats — assume the generation's OU.
  const customGame = id.match(/^(gen\d+)customgame$/);
  if (customGame) return `${customGame[1]}ou`;
  return id || 'gen9ou';
}

/**
 * Only the data.pkmn.cc mirror sends CORS headers — the historical
 * www.smogon.com fallback months could never succeed in a browser and only
 * produced 16+ console errors per load (B14), so they are gone.
 *
 * Formats without a stats file (custom rulesets, niche metas) fall back to
 * the generation's OU so the app still has usage-based assumptions.
 */
export function buildSmogonStatsUrls(
  formatId: string | undefined,
): { month: string; format: string; url: string }[] {
  const format = getSmogonStatsFormat(formatId);
  const candidates = [format];
  const gen = format.match(/^gen\d+/)?.[0];
  if (gen) {
    // Per-species merge fallbacks (fetchSmogonUsageStats): a format's file
    // existing does not mean it lists every Pokémon — VGC fills from the
    // doubles ladder, everything from the gen's OU, and OU-banned species
    // (draft leagues, VGC) from Ubers.
    if (format.includes('vgc')) candidates.push(`${gen}doublesou`);
    candidates.push(`${gen}ou`, `${gen}ubers`);
  }
  return [...new Set(candidates)].map(candidate => ({
    month: 'latest',
    format: candidate,
    url: dataPkmnStatsUrl(candidate),
  }));
}

export async function fetchSmogonUsageStats(
  formatId: string | undefined,
  options?: { now?: Date; signal?: AbortSignal; fetcher?: typeof fetch },
): Promise<SmogonUsageStats | null> {
  const format = getSmogonStatsFormat(formatId);
  const cacheKey = `${format}:${options?.now?.toISOString() ?? 'latest'}`;
  const cached = usageCache.get(cacheKey);
  if (cached) return cached;

  const fetcher = options?.fetcher ?? fetch;
  const request = (async () => {
    // Fetch every candidate and merge per species: the format's own file
    // wins, the generation's OU fills species it lacks. A niche format's
    // stats file existing must not blank out guessing for a Pokémon that
    // simply is not played there (e.g. Annihilape missing from doublesou).
    const results: SmogonUsageStats[] = [];
    for (const candidate of buildSmogonStatsUrls(formatId)) {
      try {
        const response = await fetcher(candidate.url, { signal: options?.signal });
        if (!response.ok) continue;
        const payload = await response.json();
        results.push(parseSmogonChaosStats(payload, {
          format: candidate.format,
          month: candidate.month,
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
      }
    }
    const [primary, ...fallbacks] = results;
    if (!primary) return null;
    for (const fallback of fallbacks) {
      for (const [id, entry] of Object.entries(fallback.pokemon)) {
        primary.pokemon[id] ??= entry;
      }
    }
    return primary;
  })();

  usageCache.set(cacheKey, request);
  return request;
}

export function getSpeciesUsageStats(
  species: string,
  usageStats?: SmogonUsageStats | null,
): PokemonUsageStats | undefined {
  if (!usageStats) return undefined;
  return usageStats.pokemon[toId(species)] ??
    Object.values(usageStats.pokemon).find(entry => toId(entry.species) === toId(species));
}

export function getSpeciesUsageSet(
  usageStats: SmogonUsageStats | null | undefined,
  species: string,
  ruledOut?: { abilities?: string[]; items?: string[] },
): SpeciesUsageSet | null {
  const stats = getSpeciesUsageStats(species, usageStats);
  if (!stats || !usageStats) return null;

  // Protocol evidence can DISPROVE the top usage pick (a Clefable that takes
  // Stealth Rock damage is not Magic Guard) — fall to the next candidate.
  const firstAllowed = (entries: UsageProbability[], excluded?: string[]) =>
    entries.find(entry => !(excluded ?? []).includes(toId(entry.value)));

  return {
    ability: firstAllowed(stats.abilities, ruledOut?.abilities),
    item: firstAllowed(stats.items, ruledOut?.items),
    moves: stats.moves.slice(0, 4),
    spread: stats.spreads[0],
    sourceDetail: sourceDetail(usageStats.format, usageStats.month),
  };
}

export function guessedFieldFromUsage(guess: UsageProbability | undefined): PokemonFieldInfo | null {
  if (!guess?.value) return null;
  return {
    value: guess.value,
    source: 'guessed',
    probability: guess.probability,
    sourceDetail: guess.sourceDetail,
  };
}

export function fillUsageMoves(
  species: string,
  knownMoves: PokemonMoveInfo[],
  usageStats?: SmogonUsageStats | null,
): PokemonMoveInfo[] {
  const set = getSpeciesUsageStats(species, usageStats);
  if (!set) return knownMoves;

  const result = [...knownMoves];
  for (const move of set.moves) {
    if (result.length >= 4) break;
    if (!result.some(known => toId(known.name) === toId(move.value))) {
      result.push({
        name: move.value,
        source: 'guessed',
        probability: move.probability,
        sourceDetail: move.sourceDetail,
      });
    }
  }
  return result;
}
