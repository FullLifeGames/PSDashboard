import type {
  ChaosStatsPayload, PkmnStatsPayload, PokemonUsageStats, SmogonUsageStats, UsageProbability, UsageSpread,
} from './stats-types';
import { toId } from '../ids';
import { sourceDetail } from './usage-lookup';

export function dataPkmnStatsUrl(format: string): string {
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
  return usageRows(rows, detail, kind, count => normalizeUsageValue(count, denominator, bucketTotal));
}

/** Display-named, positive, sorted usage rows; `probabilityOf` prices one raw entry. */
function usageRows(
  rows: [string, number][],
  detail: string,
  kind: 'abilities' | 'items' | 'moves',
  probabilityOf: (count: number) => number,
): UsageProbability[] {
  return rows
    .map(([value, count]) => ({
      value: lookupDisplayName(kind, value),
      probability: probabilityOf(count),
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
  return usageRows(numericEntries(entries), detail, kind, normalizeFractionalProbability);
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
  return spreadRowsOf(rows, detail, count => normalizeUsageValue(count, denominator, bucketTotal));
}

/** Parsed, positive, sorted spread rows; `probabilityOf` prices one raw entry. */
function spreadRowsOf(
  rows: [string, number][],
  detail: string,
  probabilityOf: (count: number) => number,
): UsageSpread[] {
  return rows
    .map(([value, count]) => {
      const spread = parseSpread(value);
      if (!spread) return null;
      return {
        value,
        ...spread,
        probability: probabilityOf(count),
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
  return spreadRowsOf(numericEntries(entries), detail, normalizeFractionalProbability);
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
