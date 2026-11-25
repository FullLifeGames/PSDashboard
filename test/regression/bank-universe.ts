import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { FAMILY_NAMES, familyOfFormat, type FamilyName } from './fit-families';

export const HOLDOUT_MANIFEST = 'test/regression/fixtures/fit-holdout-manifest.json';
export const FIT_MANIFEST = 'test/regression/fixtures/fit-corpus-manifest.json';

export interface BankUniverse {
  ids: string[];
  trancheOf: Map<string, string>;
  cached: boolean;
  sampleTurns(maxTurn: number): number[];
}

export function phaseOf(turn: number, maxTurn: number): 'early' | 'mid' | 'late' {
  const fraction = turn / maxTurn;
  return fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'mid' : 'late';
}

export function bankTurns(maxTurn: number): number[] {
  const step = Math.max(1, Math.ceil(maxTurn / 8));
  const turns: number[] = [];
  for (let turn = 2; turn < maxTurn; turn += step) turns.push(turn);
  return turns;
}

export function holdoutTurns(maxTurn: number): number[] {
  const turns: number[] = [];
  (['early', 'mid', 'late'] as const).forEach((phase, third) => {
    const inThird: number[] = [];
    for (let turn = 2; turn < maxTurn; turn++) if (phaseOf(turn, maxTurn) === phase) inThird.push(turn);
    if (inThird.length === 0) return;
    const target = Math.round(((2 * third + 1) / 6) * maxTurn);
    turns.push(Math.min(inThird[inThird.length - 1], Math.max(inThird[0], target)));
  });
  return turns;
}

/** The ladder rating of a cached fit replay: null when it has none, undefined when the cache lacks the replay. */
export function cachedRating(id: string): number | null | undefined {
  const path = `.fit-corpus/${id}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as { rating?: number | null }).rating ?? null : undefined;
}

export function holdoutSets(): { key: string; family: string; ids: string[] }[] {
  return (JSON.parse(readFileSync(HOLDOUT_MANIFEST, 'utf-8')) as { sets: { key: string; family: string; ids: string[] }[] }).sets;
}

const ratedOrUncached = (id: string): boolean => {
  const rating = cachedRating(id);
  return rating === undefined || (rating ?? 0) > 0;
};

function familyUniverse(family: string, replays: { id: string; format: string; source: 'tournament' | 'ladder' }[]) {
  if (!(FAMILY_NAMES as readonly string[]).includes(family)) {
    throw new Error(`unknown EVAL_CALIBRATION_FAMILY ${family} (${FAMILY_NAMES.join(', ')})`);
  }
  const held = new Set(holdoutSets().flatMap(set => set.ids));
  return replays.filter(entry => familyOfFormat(entry.format) === (family as FamilyName) && !held.has(entry.id)
    && (entry.source === 'tournament' || ratedOrUncached(entry.id)));
}

function turnRule(own: (maxTurn: number) => number[]): (maxTurn: number) => number[] {
  const rule = process.env.EVAL_CALIBRATION_TURNS;
  if (rule === undefined || rule === '') return own;
  if (rule !== 'thirds') throw new Error(`unknown EVAL_CALIBRATION_TURNS ${rule} (thirds)`);
  return holdoutTurns;
}

export function quickFraction(raw: string | undefined = process.env.EVAL_CALIBRATION_FRACTION): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const fraction = Number(raw);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(`EVAL_CALIBRATION_FRACTION must be a number above 0 and at most 1 (a share of the universe), got "${raw}"`);
  }
  return fraction;
}

const quickKeep = (size: number, fraction: number): number => Math.min(size, Math.max(1, Math.floor(size * fraction + 0.5 + 1e-9)));

export function quickSubset(ids: readonly string[], trancheOf: ReadonlyMap<string, string>, fraction: number): string[] {
  if (fraction >= 1) return [...ids];
  const strata = new Map<string, string[]>();
  for (const id of ids) {
    const key = `${trancheOf.get(id) ?? 'unknown'}\u0000${familyOfFormat(id)}`;
    const members = strata.get(key);
    if (members) members.push(id);
    else strata.set(key, [id]);
  }
  const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const kept = new Set<string>();
  for (const members of strata.values()) {
    members
      .map(id => ({ id, rank: createHash('sha256').update(id).digest('hex') }))
      .sort((a, b) => before(a.rank, b.rank) || before(a.id, b.id))
      .slice(0, quickKeep(members.length, fraction))
      .forEach(entry => kept.add(entry.id));
  }
  return ids.filter(id => kept.has(id));
}

function thinned(universe: BankUniverse, fraction: number): BankUniverse {
  if (fraction >= 1) return universe;
  const ids = quickSubset(universe.ids, universe.trancheOf, fraction);
  const kept = new Set(ids);
  return { ...universe, ids, trancheOf: new Map([...universe.trancheOf].filter(([id]) => kept.has(id))) };
}

/** Source `fit` reads the games that trained the weights: its numbers are never calibration records. */
export function bankUniverse(bank: { ids: string[]; trancheOf: Map<string, string> }): BankUniverse {
  const fraction = quickFraction();
  return thinned(wholeUniverse(bank), fraction);
}

function wholeUniverse(bank: { ids: string[]; trancheOf: Map<string, string> }): BankUniverse {
  const source = process.env.EVAL_CALIBRATION_SOURCE;
  const family = process.env.EVAL_CALIBRATION_FAMILY;
  if (family && source !== 'fit') throw new Error('EVAL_CALIBRATION_FAMILY reads the fit corpus — set EVAL_CALIBRATION_SOURCE=fit');
  if (source === 'holdout') {
    const sets = holdoutSets();
    return {
      ids: sets.flatMap(set => set.ids),
      trancheOf: new Map(sets.flatMap(set => set.ids.map(id => [id, `holdout-${set.family}`] as const))),
      cached: true,
      sampleTurns: turnRule(holdoutTurns),
    };
  }
  if (source === undefined || source === '') return { ...bank, cached: false, sampleTurns: turnRule(bankTurns) };
  if (source !== 'fit') throw new Error(`unknown EVAL_CALIBRATION_SOURCE ${source} (fit or holdout)`);
  if (!process.env.EVAL_CALIBRATION_DUMP) {
    throw new Error('EVAL_CALIBRATION_SOURCE=fit produces fit-side dumps only — set EVAL_CALIBRATION_DUMP');
  }
  const manifest = JSON.parse(readFileSync(FIT_MANIFEST, 'utf-8')) as { replays: { id: string; format: string; source: 'tournament' | 'ladder' }[] };
  const replays = family ? familyUniverse(family, manifest.replays) : manifest.replays;
  return {
    ids: replays.map(entry => entry.id),
    trancheOf: new Map(replays.map(entry => [entry.id, `fit-${entry.source}`])),
    cached: true,
    sampleTurns: turnRule(bankTurns),
  };
}
