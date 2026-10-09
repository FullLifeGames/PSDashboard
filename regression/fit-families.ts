import { readFileSync } from 'node:fs';
import { atKScore, layoutOf, refitAtKReport, type AtKReportOptions, type AtKSample, type GameTypeK } from './fit-helpers';

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
}

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
  return paths
    .flatMap(path => readFileSync(path, 'utf-8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as BankRow))
    .filter(row => Array.isArray(row.g))
    .map(row => {
      const ruleset = rulesetOfId(row.id);
      return {
        game: row.id, set: setOf(row, familyOf({ ruleset, gameType: row.gameType })), gameType: row.gameType, ruleset,
        g: row.g!, p1Won: row.p1Won, faintedFraction: row.faintedFraction, score: row.score, wp: true,
        lastPair: row.lastPair ?? false, source: row.tranche === 'fit-tournament' ? 'tournament' : 'ladder', rating: row.rating ?? null,
      };
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
 * into the leaf value for wp samples), or the capture and the tables
 * disagree and the report stops.
 */
export function familyReports(
  samples: FamilySample[], names: string[], families: FamilyTables[], k: GameTypeK, options: AtKReportOptions,
  leaf: (tanh: number, doubles: boolean, faintedFraction: number) => number,
): { identity: { samples: number; off: number }; families: Record<string, FamilyReport> } {
  let off = 0;
  let checked = 0;
  const reports: Record<string, FamilyReport> = {};
  for (const family of families) {
    const subset = samples.filter(sample => familyOf(sample) === family.name);
    const { layout, start } = layoutOf(family.singles, family.doubles);
    const atK: AtKSample[] = subset.map(sample => ({
      g: sample.g, won: sample.p1Won, doubles: sample.gameType === 'doubles', faintedFraction: sample.faintedFraction, game: sample.set,
    }));
    subset.forEach((sample, i) => {
      if (sample.lastPair) return;
      checked++;
      const tanh = atKScore(atK[i], start, layout);
      const expected = sample.wp ? leaf(tanh, atK[i].doubles, sample.faintedFraction) : tanh;
      if (Math.abs(expected - sample.score) > 1e-9) off++;
    });
    const games = new Set(atK.map(sample => sample.game)).size;
    reports[family.name] = games < options.minGames
      ? { skipped: games === 0 ? 'no games' : `${games} sets, below ${options.minGames}`, games }
      : refitWithSecondPass(atK, names, family, k, options);
  }
  if (off > 0) throw new Error(`identity: ${off} of ${checked} captured scores differ from the start tables`);
  return { identity: { samples: checked, off }, families: reports };
}
