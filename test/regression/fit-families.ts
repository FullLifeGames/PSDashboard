import { readFileSync } from 'node:fs';
import {
  atKScore, bootstrapPhaseK, brierScore, fitPhaseK, layoutOf, logLossScore, phaseBucket, refitAtKReport,
  type AtKReportOptions, type AtKSample, type GameTypeK, type PhaseK, type PhaseKSpread,
} from './fit-helpers';


export type Ruleset = 'standard' | 'vgc' | 'champions';
export type FamilyName = `${Ruleset}-${'singles' | 'doubles'}`;

export interface FamilySample {
  game: string;
  set: string;
  gameType: 'singles' | 'doubles';
  ruleset: Ruleset;
  g: number[];
  p1Won: boolean;
  faintedFraction: number;
  /** The captured score: the static's leaf value in wp-units when `wp`, the tanh otherwise. */
  score: number;
  wp?: boolean;
  /** The bank prices the last pair by its race, not by the static: no identity check there. */
  lastPair?: boolean;
  /** `score` is the search's root value, so no start table gives it back: no identity check. */
  search?: boolean;
  source?: 'tournament' | 'ladder';
  /** The replay's ladder rating (null or 0 for tournament games and unrated games). */
  rating?: number | null;
}

export const rulesetOfId = (id: string): Ruleset => {
  if (/champions/.test(id)) return 'champions';
  return /vgc/.test(id) ? 'vgc' : 'standard';
};

export const familyOf = (sample: Pick<FamilySample, 'ruleset' | 'gameType'>): FamilyName => `${sample.ruleset}-${sample.gameType}`;

export const FAMILY_NAMES: readonly FamilyName[] = ['standard-singles', 'standard-doubles', 'vgc-doubles', 'champions-singles', 'champions-doubles'];

export const familyOfFormat = (format: string): FamilyName =>
  familyOf({ ruleset: rulesetOfId(format), gameType: /doubles|vgc/.test(format) ? 'doubles' : 'singles' });

const rulesetOfFamily = (name: string): Ruleset => name.split('-')[0] as Ruleset;

export type KOf = (ruleset: Ruleset) => GameTypeK;

const playerId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

interface BankRow {
  id: string;
  tranche?: string;
  gameType: 'singles' | 'doubles';
  score: number;
  faintedFraction: number;
  p1Won: boolean;
  lastPair?: boolean;
  g?: number[];
  rating?: number | null;
  /** The root fields only a search writes: null or missing under EVAL_CALIBRATION_STATIC=1. */
  gameValue?: number | null;
  decided?: string | null;
  decidedHeld?: string | null;
  forcedWinMass?: number | null;
}

const fromSearch = (row: BankRow): boolean =>
  row.gameValue != null || row.decided != null || row.decidedHeld != null || row.forcedWinMass != null;

export function dumpSamples(paths: string[], playersOf: (id: string) => string[]): FamilySample[] {
  const players = new Map<string, string>();
  const setOf = (row: BankRow, family: string) => {
    let key = players.get(row.id);
    if (key === undefined) {
      key = playersOf(row.id).map(playerId).sort().join('|');
      players.set(row.id, key);
    }
    return `${family}|${key}`;
  };
  return paths.flatMap(path => {
    const rows = readFileSync(path, 'utf-8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as BankRow);
    const search = rows.some(fromSearch);
    return rows.filter(row => Array.isArray(row.g)).map(row => {
      const ruleset = rulesetOfId(row.id);
      return {
        game: row.id, set: setOf(row, familyOf({ ruleset, gameType: row.gameType })), gameType: row.gameType, ruleset,
        g: row.g!, p1Won: row.p1Won, faintedFraction: row.faintedFraction, score: row.score, wp: true,
        lastPair: row.lastPair ?? false, search, source: row.tranche === 'fit-tournament' ? 'tournament' : 'ladder', rating: row.rating ?? null,
      };
    });
  });
}

export function withoutHoldout<T extends { game: string }>(samples: T[], holdout: ReadonlySet<string>): { kept: T[]; dropped: number } {
  const kept = samples.filter(sample => !holdout.has(sample.game));
  return { kept, dropped: samples.length - kept.length };
}

/** A Bo1 ladder game without a rating left the ladder and leaves the fit; a Bo3 set rates only its last game. */
export function withoutUnratedLadder<T extends { source?: 'tournament' | 'ladder'; rating?: number | null }>(samples: T[]): { kept: T[]; dropped: number } {
  const kept = samples.filter(sample => sample.source === 'tournament' || (sample.rating ?? 0) > 0);
  return { kept, dropped: samples.length - kept.length };
}

export interface FamilyTables { name: string; singles: number[]; doubles: number[] }

type Refit = ReturnType<typeof refitAtKReport>;
export function liftHolds(hold: { shared: string[]; doubles: string[] }, lifted: string[]): { shared: string[]; doubles: string[] } {
  return { shared: hold.shared.filter(name => !lifted.includes(name)), doubles: hold.doubles.filter(name => !lifted.includes(name)) };
}

export interface ModelForm { kind: 'phase' | 'root'; key: string }

export function parseModelForms(text: string): ModelForm[] {
  return text.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const [kind, key] = part.split(':');
    if ((kind !== 'phase' && kind !== 'root') || !key) throw new Error(`model form: ${part} (expected phase:<feature> or root:<feature>)`);
    return { kind, key };
  });
}

export function parseWeightSet(text: string): Record<string, number> {
  return Object.fromEntries(text.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, weight] = part.split('=');
    if (!name || weight === undefined || !Number.isFinite(Number(weight))) throw new Error(`weight set: ${part} (expected name=weight)`);
    return [name, Number(weight)];
  }));
}

const formValue = (kind: ModelForm['kind'], value: number, faintedFraction: number): number =>
  kind === 'phase' ? value * faintedFraction : Math.sign(value) * Math.sqrt(Math.abs(value));

export function withModelForms(
  samples: FamilySample[], names: string[], families: FamilyTables[], forms: ModelForm[],
): { samples: FamilySample[]; names: string[]; families: FamilyTables[] } {
  const columns = forms.map(form => {
    const index = names.indexOf(form.key);
    if (index < 0) throw new Error(`model form: no feature named ${form.key}`);
    return { form, index };
  });
  return {
    names: [...names, ...forms.map(form => `${form.key}@${form.kind}`)],
    samples: samples.map(sample => ({
      ...sample, g: [...sample.g, ...columns.map(({ form, index }) => formValue(form.kind, sample.g[index], sample.faintedFraction))],
    })),
    families: families.map(family => ({
      ...family, singles: [...family.singles, ...forms.map(() => 0)], doubles: [...family.doubles, ...forms.map(() => 0)],
    })),
  };
}

type FamilyReport = Refit | (Refit & { first: Refit; secondPassHeld: string[] }) | { skipped: string; games: number };

function refitWithSecondPass(
  atK: AtKSample[], names: string[], family: FamilyTables, k: GameTypeK, options: AtKReportOptions,
): FamilyReport {
  const first = refitAtKReport(atK, names, family.singles, family.doubles, k, options);
  const flagged = first.verdict.flagged;
  if (flagged.length === 0) return first;
  const named = (table: string) => flagged.filter(flag => flag.startsWith(`${table}:`)).map(flag => flag.slice(table.length + 1));
  const hold = {
    shared: [...(options.hold?.shared ?? []), ...named('shared')],
    doubles: [...(options.hold?.doubles ?? []), ...named('doubles')],
  };
  const second = refitAtKReport(atK, names, family.singles, family.doubles, k, { ...options, hold });
  return { ...second, first, secondPassHeld: flagged };
}

export function familyReports(
  samples: FamilySample[], names: string[], families: FamilyTables[], kOf: KOf, options: AtKReportOptions,
  leaf: (tanh: number, doubles: boolean, faintedFraction: number, ruleset: Ruleset) => number,
): { identity: { samples: number; off: number; skipped?: number }; families: Record<string, FamilyReport> } {
  let off = 0;
  let checked = 0;
  let skipped = 0;
  const reports: Record<string, FamilyReport> = {};
  for (const family of families) {
    const subset = samples.filter(sample => familyOf(sample) === family.name);
    const asCaptured = (table: number[]) => table.map((weight, j) => options.captured?.[names[j]] ?? weight);
    const { layout, start } = layoutOf(asCaptured(family.singles), asCaptured(family.doubles));
    const atK: AtKSample[] = subset.map(sample => ({
      g: sample.g, won: sample.p1Won, doubles: sample.gameType === 'doubles', faintedFraction: sample.faintedFraction, game: sample.set,
    }));
    subset.forEach((sample, i) => {
      if (sample.lastPair) return;
      if (sample.search) {
        skipped++;
        return;
      }
      checked++;
      const tanh = atKScore(atK[i], start, layout);
      const expected = sample.wp ? leaf(tanh, atK[i].doubles, sample.faintedFraction, sample.ruleset) : tanh;
      if (Math.abs(expected - sample.score) > 1e-9) off++;
    });
    const games = new Set(atK.map(sample => sample.game)).size;
    reports[family.name] = games < options.minGames
      ? { skipped: games === 0 ? 'no games' : `${games} sets, below ${options.minGames}`, games }
      : refitWithSecondPass(atK, names, family, kOf(rulesetOfFamily(family.name)), options);
  }
  if (off > 0) throw new Error(`identity: ${off} of ${checked} captured scores differ from the start tables`);
  return { identity: { samples: checked, off, ...(skipped > 0 ? { skipped } : {}) }, families: reports };
}

type Bucket = 'early' | 'mid' | 'late';
interface PhaseBucketScores { n: number; brierToday: number; brierFitted: number; logLossToday: number; logLossFitted: number }
export interface PhaseKReport { n: number; sets: number; today: PhaseK; fitted: PhaseK; spread: PhaseKSpread; buckets: Record<Bucket, PhaseBucketScores> }

export function phaseKReports(
  samples: FamilySample[], families: FamilyTables[], kOf: KOf, draws: number,
): Record<string, PhaseKReport | { skipped: string }> {
  const reports: Record<string, PhaseKReport | { skipped: string }> = {};
  for (const family of families) {
    const subset = samples.filter(sample => familyOf(sample) === family.name && !sample.lastPair);
    if (subset.length < 100) {
      reports[family.name] = { skipped: `${subset.length} samples, below 100` };
      continue;
    }
    const { layout, start } = layoutOf(family.singles, family.doubles);
    const doubles = family.name.endsWith('-doubles');
    const outcome = subset.map(sample => ({
      score: atKScore({ g: sample.g, won: sample.p1Won, doubles, faintedFraction: sample.faintedFraction, game: sample.set }, start, layout),
      faintedFraction: sample.faintedFraction, won: sample.p1Won, game: sample.set,
    }));
    const k = kOf(rulesetOfFamily(family.name));
    const today = doubles ? k.doubles : k.singles;
    const fitted = fitPhaseK(outcome);
    const bucket = (name: Bucket): PhaseBucketScores => {
      const inBucket = outcome.filter(sample => phaseBucket(sample.faintedFraction) === name);
      return {
        n: inBucket.length,
        brierToday: brierScore(inBucket, today.k0, today.k1), brierFitted: brierScore(inBucket, fitted.k0, fitted.k1),
        logLossToday: logLossScore(inBucket, today.k0, today.k1), logLossFitted: logLossScore(inBucket, fitted.k0, fitted.k1),
      };
    };
    reports[family.name] = {
      n: outcome.length, sets: new Set(outcome.map(sample => sample.game)).size, today, fitted,
      spread: bootstrapPhaseK(outcome, draws, 48), buckets: { early: bucket('early'), mid: bucket('mid'), late: bucket('late') },
    };
  }
  return reports;
}

const ROOT_VALUE_CLAMP = 1 - 1e-4;
export const rootLogit = (value: number): number => 2 * Math.atanh(Math.max(-ROOT_VALUE_CLAMP, Math.min(ROOT_VALUE_CLAMP, value)));

interface RootBucketScores extends PhaseBucketScores { kToday: number; kFitted: number }
export interface RootScaleReport {
  n: number; sets: number;
  clamped: number;
  capturedK: PhaseK;
  /** The scale of the logit, c0 + c1·ff (fitPhaseK on the logit); 1 + 0·ff is an honest search. */
  scale: PhaseK;
  spread: PhaseKSpread;
  kPrime: PhaseK;
  buckets: Record<Bucket, RootBucketScores>;
}

export function rootScaleReports(
  samples: FamilySample[], kOf: KOf, captured: KOf, draws: number,
): Record<string, RootScaleReport | { skipped: string }> {
  const present = new Set(samples.map(sample => familyOf(sample)));
  const reports: Record<string, RootScaleReport | { skipped: string }> = {};
  for (const name of FAMILY_NAMES.filter(family => present.has(family))) {
    const doubles = name.endsWith('-doubles');
    const ruleset = rulesetOfFamily(name);
    const stamped = doubles ? captured(ruleset).doubles : captured(ruleset).singles;
    const today = doubles ? kOf(ruleset).doubles : kOf(ruleset).singles;
    if (Math.abs(stamped.k0 - today.k0) > 1e-9 || Math.abs(stamped.k1 - today.k1) > 1e-9) {
      throw new Error(
        `root scale ${name}: the capture was made under K ${stamped.k0} + ${stamped.k1}·ff, today's table says ${today.k0} + ${today.k1}·ff — fit at the capture's commit`,
      );
    }
    const subset = samples.filter(sample => familyOf(sample) === name && !sample.lastPair);
    if (subset.length < 100) {
      reports[name] = { skipped: `${subset.length} samples, below 100` };
      continue;
    }
    const outcome = subset.map(sample => ({ score: rootLogit(sample.score), faintedFraction: sample.faintedFraction, won: sample.p1Won, game: sample.set }));
    const scale = fitPhaseK(outcome);
    const spread = bootstrapPhaseK(outcome, draws, 48);
    const kAt = (ff: number) => today.k0 + today.k1 * ff;
    let sx = 0; let sxx = 0; let sy = 0; let sxy = 0;
    for (const { faintedFraction: x } of outcome) {
      const y = kAt(x) * (scale.k0 + scale.k1 * x);
      sx += x; sxx += x * x; sy += y; sxy += x * y;
    }
    const n = outcome.length;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const bucket = (phase: Bucket): RootBucketScores => {
      const inBucket = outcome.filter(sample => phaseBucket(sample.faintedFraction) === phase);
      const mean = (f: (sample: (typeof outcome)[number]) => number) => inBucket.reduce((sum, sample) => sum + f(sample), 0) / Math.max(1, inBucket.length);
      return {
        n: inBucket.length,
        brierToday: brierScore(inBucket, 1), brierFitted: brierScore(inBucket, scale.k0, scale.k1),
        logLossToday: logLossScore(inBucket, 1), logLossFitted: logLossScore(inBucket, scale.k0, scale.k1),
        kToday: mean(sample => kAt(sample.faintedFraction)), kFitted: mean(sample => kAt(sample.faintedFraction) * (scale.k0 + scale.k1 * sample.faintedFraction)),
      };
    };
    reports[name] = {
      n, sets: new Set(outcome.map(sample => sample.game)).size, clamped: subset.filter(sample => Math.abs(sample.score) > ROOT_VALUE_CLAMP).length,
      capturedK: stamped, scale,
      spread: { ...spread, at: spread.at.map(entry => ({ ...entry, k: kAt(entry.ff) * entry.k, lo: kAt(entry.ff) * entry.lo, hi: kAt(entry.ff) * entry.hi })) },
      kPrime: { k0: (sy - slope * sx) / n, k1: slope },
      buckets: { early: bucket('early'), mid: bucket('mid'), late: bucket('late') },
    };
  }
  return reports;
}

/** A missing rule set or K stops the report; there is no fallback to today's table. */
export function parseKTable(text: string): KOf {
  const stamp = JSON.parse(text) as Record<string, Partial<Record<'singles' | 'doubles', Partial<PhaseK>>>>;
  for (const ruleset of ['standard', 'vgc', 'champions']) {
    for (const gameType of ['singles', 'doubles'] as const) {
      const k = stamp[ruleset]?.[gameType];
      if (!k || !Number.isFinite(k.k0) || !Number.isFinite(k.k1)) throw new Error(`K stamp: no k0 and k1 for ${ruleset} ${gameType}`);
    }
  }
  return ruleset => stamp[ruleset] as GameTypeK;
}
