import { readFileSync } from 'node:fs';
import {
  atKScore, bootstrapPhaseK, brierScore, fitPhaseK, layoutOf, logLossScore, phaseBucket, refitAtKReport,
  type AtKReportOptions, type AtKSample, type GameTypeK, type PhaseK, type PhaseKSpread,
} from './fit-helpers';

/**
 * Round 65: the static's refit per family. Pokémon Champions OU and
 * Champions VGC are their own games, and Doubles OU parts from both: one
 * doubles table fitted on Champions VGC and the Scarlet/Violet doubles
 * together served neither, and the shared weights let the singles corpus
 * decide the doubles game. Each family (rule set × game type) now refits on
 * its own games, read from calibration-bank dumps (the corpus with the app's
 * team build and the bank's reconstruction, EVAL_CALIBRATION_SOURCE=fit with
 * EVAL_CALIBRATION_STATIC=1 and EVAL_CALIBRATION_FEATURES=1), without the
 * holdout and clustered by set, so a Bo3 counts once in the folds and the
 * bootstrap.
 */

export type Ruleset = 'standard' | 'vgc' | 'champions';
export type FamilyName = `${Ruleset}-${'singles' | 'doubles'}`;

export interface FamilySample {
  game: string;
  /** The cluster key: the family and the two players. */
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
  /**
   * Round 74 (T163, T263): the dump came from a search, so `score` is the root value of the search and no start table
   * gives it back: no identity check there. A weight fit on such a dump needs only `g`, the outcome and the start tables.
   */
  search?: boolean;
  source?: 'tournament' | 'ladder';
  /** The replay's ladder rating (null or 0 for tournament games and unrated games). */
  rating?: number | null;
}

/** The rule set of a corpus game, from its id (the hosts resolve it from the same format id, replayRuleset). */
export const rulesetOfId = (id: string): Ruleset => {
  if (/champions/.test(id)) return 'champions';
  return /vgc/.test(id) ? 'vgc' : 'standard';
};

export const familyOf = (sample: Pick<FamilySample, 'ruleset' | 'gameType'>): FamilyName => `${sample.ruleset}-${sample.gameType}`;

/** The five families of the fit corpus, in the order the fit tool lists them. */
export const FAMILY_NAMES: readonly FamilyName[] = ['standard-singles', 'standard-doubles', 'vgc-doubles', 'champions-singles', 'champions-doubles'];

/**
 * The family of a corpus format (round 69, T163): the doubles formats are Doubles OU and the VGC
 * formats of both games, every other format plays singles. The replay log says the same
 * (|gametype|doubles), which the universe cannot read before it fetches a replay.
 */
export const familyOfFormat = (format: string): FamilyName =>
  familyOf({ ruleset: rulesetOfId(format), gameType: /doubles|vgc/.test(format) ? 'doubles' : 'singles' });

/** The rule set of a family name ('champions-doubles' is Champions). */
const rulesetOfFamily = (name: string): Ruleset => name.split('-')[0] as Ruleset;

/** The leaf's phase K per rule set (round 67, T138: Pokémon Champions prices its own scale). */
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
  /** The root fields only a search writes (test/regression/eval-calibration.spec.ts rootReading): null or missing under EVAL_CALIBRATION_STATIC=1. */
  gameValue?: number | null;
  decided?: string | null;
  decidedHeld?: string | null;
  forcedWinMass?: number | null;
}

/** A row that carries a root field of a search. A static capture writes all of them as null, a dump from before round 67 none. */
const fromSearch = (row: BankRow): boolean =>
  row.gameValue != null || row.decided != null || row.decidedHeld != null || row.forcedWinMass != null;

/**
 * Samples from calibration-bank dumps (one JSON line per position, with g).
 * `playersOf` names a game's two players (from the corpus cache); rows
 * without a feature vector stay out.
 */
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
  // Round 74: a dump is a search's when any of its rows carries a root field of a search (a tree turn alone leaves them null).
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

/** The samples outside the holdout (scripts/build-fit-holdout.mjs), and how many it took. */
export function withoutHoldout<T extends { game: string }>(samples: T[], holdout: ReadonlySet<string>): { kept: T[]; dropped: number } {
  const kept = samples.filter(sample => !holdout.has(sample.game));
  return { kept, dropped: samples.length - kept.length };
}

/**
 * Round 66: a Bo1 ladder game without a rating was played after its format
 * left the ladder, as a challenge of unknown level (the 600 Champions VGC
 * Bo3 games of round 65, uploaded after the M-B ladder ended). Such games
 * stay in the corpus and in the holdout but leave the fit. On a Bo3 ladder
 * only the deciding game of a set carries the rating, so this rule would
 * also drop games 1 and 2 of a rated Bo3 set; the corpus holds no rated Bo3
 * ladder game today (the review of round 66), and a Bo3 ladder expansion
 * must first give the whole set its rating.
 */
export function withoutUnratedLadder<T extends { source?: 'tournament' | 'ladder'; rating?: number | null }>(samples: T[]): { kept: T[]; dropped: number } {
  const kept = samples.filter(sample => sample.source === 'tournament' || (sample.rating ?? 0) > 0);
  return { kept, dropped: samples.length - kept.length };
}

/** One family's start tables (its singles and doubles weights in feature order). */
export interface FamilyTables { name: string; singles: number[]; doubles: number[] }

type Refit = ReturnType<typeof refitAtKReport>;
/**
 * Round 69 (T49, T102): the pre-registered holds minus the columns a fit lifts
 * (`EVAL_FIT_LIFT=boosts`: the boost weight is free for the T49 and T102 fits
 * only, decision 16).
 */
export function liftHolds(hold: { shared: string[]; doubles: string[] }, lifted: string[]): { shared: string[]; doubles: string[] } {
  return { shared: hold.shared.filter(name => !lifted.includes(name)), doubles: hold.doubles.filter(name => !lifted.includes(name)) };
}

/**
 * Round 69 (T102, decision 17): model-form candidates as derived columns of
 * the same fit. `phase` weighs a feature with the share of fainted mons
 * (weight x (1 + c x faintedFraction) is the weight plus c on this column),
 * `root` takes the signed square root of its addend (a feature that saturates).
 * Both are columns of g, named `<feature>@phase` and `<feature>@root`, at 0 in
 * every start table, so the identity check and the hand score do not move; a
 * fit frees them by name (`only`).
 */
export interface ModelForm { kind: 'phase' | 'root'; key: string }

/** `phase:bodies,root:matchup` (the EVAL_FIT_FORMS list). */
export function parseModelForms(text: string): ModelForm[] {
  return text.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const [kind, key] = part.split(':');
    if ((kind !== 'phase' && kind !== 'root') || !key) throw new Error(`model form: ${part} (expected phase:<feature> or root:<feature>)`);
    return { kind, key };
  });
}

/** `boosts=0,boostsBiting=2.25` (the EVAL_FIT_SET list): start weights by column. */
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

/** A family's refit; after a second pass (rule R2) the first pass and the weights it added to the holds ride along. */
type FamilyReport = Refit | (Refit & { first: Refit; secondPassHeld: string[] }) | { skipped: string; games: number };

/**
 * Rule R2 of round 65: the weights the first pass flags (a flipped sign, a
 * 90 % band wider than twice the value) join the holds, and the family
 * refits once; flags of the second pass stay in its report.
 */
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

/**
 * The refit of every family on its own samples, with the shared options
 * (the pre-registered holds among them). First the identity: the start
 * tables must give back every captured score (`leaf` turns the static's tanh
 * into the leaf value for wp samples, under the K of the sample's rule set),
 * or the capture and the tables disagree and the report stops. A sample of a dump from a search (round 74) holds
 * the search's root value, which no table gives back: it is left out of the check and counted in `skipped`. Each family
 * refits at the K of its rule set (`kOf`, round 67: Champions has its own).
 */
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
    // The identity reads the weights the capture was made under (options.captured), the fit the tables of today.
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
/** One phase bucket: today's K of the game type against the fitted K. */
interface PhaseBucketScores { n: number; brierToday: number; brierFitted: number; logLossToday: number; logLossFitted: number }
/** One family's phase K on its own games. */
export interface PhaseKReport { n: number; sets: number; today: PhaseK; fitted: PhaseK; spread: PhaseKSpread; buckets: Record<Bucket, PhaseBucketScores> }

/**
 * Round 67 (T138): the phase K of each family on its own games, in the form
 * of WINPROB_K (k0 + k1 × the fainted share). The static's tanh comes back
 * from each sample's features under the family's tables; the bank prices the
 * last pair by its race, so those samples stay out (the leaf K never reaches
 * them). fitPhaseK finds the likelihood maximum, the bootstrap over sets its
 * band, and every phase bucket scores today's K of the game type against the
 * fitted one. Reports only.
 */
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

/** A search value at 1 or -1 (a forced result) has no finite logit: it counts at the logit of this value. */
const ROOT_VALUE_CLAMP = 1 - 1e-4;
/** The search's logit: a root value in wp units is 2p - 1, so the odds are 2 atanh(v). */
export const rootLogit = (value: number): number => 2 * Math.atanh(Math.max(-ROOT_VALUE_CLAMP, Math.min(ROOT_VALUE_CLAMP, value)));

/** One phase bucket of a root scale report: the capture's own values against the fitted scale. */
interface RootBucketScores extends PhaseBucketScores { kToday: number; kFitted: number }
/** One family's scale of the search's logit, and the leaf K it implies. */
export interface RootScaleReport {
  n: number; sets: number;
  /** Positions whose root value was exactly certain (|v| above the clamp): the prover's rows. */
  clamped: number;
  /** The leaf K the capture ran under (the report refuses a mismatch with today's table). */
  capturedK: PhaseK;
  /** The scale of the logit, c0 + c1·ff (fitPhaseK on the logit); 1 + 0·ff is an honest search. */
  scale: PhaseK;
  /** The scale's bootstrap over sets; its `at` entries are the band of K' = K·c at 0, 1/3 and 2/3 fainted. */
  spread: PhaseKSpread;
  /** K' = K·c as a line in the fainted share (least squares on the positions' own shares). */
  kPrime: PhaseK;
  buckets: Record<Bucket, RootBucketScores>;
}

/**
 * Round 69 (T163, decision 20): the leaf K per family on the search's own root values. A capture
 * with search (no EVAL_CALIBRATION_STATIC) holds the root value in wp units; its logit is
 * 2 atanh(v). Per family the scale c0 + c1·ff of sigmoid(c·logit) against the outcome
 * (fitPhaseK on the logit, the bootstrap over sets) says how far the search's values sit from
 * honest, and K' = K·c is the leaf K that would put the root right to first order (the search
 * is no linear function of the leaf values, so the bank decides, not this fit). The last
 * pair stays out (the bank prices it by its race). The search root cannot be re-derived from
 * the features, so there is no identity check; instead the report names the K table the capture
 * ran under (`captured`) and stops when it is not today's table (`kOf`), since K·c means
 * nothing against another K. Holdout and unrated ladder games are the caller's cut.
 */
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
    // K' = K·c on every position's own phase, then the line through it (2 × 2 normal equations).
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

/**
 * The K table a capture ran under, from a stamp: `{"standard": {"singles": {"k0", "k1"}, "doubles": ...}, "vgc": ..., "champions": ...}`
 * (EVAL_FIT_ROOT_K). A missing rule set or K stops the report; it does not fall back to today's table.
 */
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
