import { existsSync, readFileSync } from 'node:fs';
import { FAMILY_NAMES, familyOfFormat, type FamilyName } from './fit-families';

/**
 * The replays a calibration bank run samples (round 65), in one place: the
 * bank's own tranches, the weight-fitting corpus, or the corpus's holdout.
 */

/**
 * Round 65: the holdout of the fit corpus (scripts/build-fit-holdout.mjs), a
 * test bank no round-65 or later fit trains on. Older fits did: the hand
 * doubles table (fitted 2026-08-08) and the doubles K (2026-08-09) saw the
 * holdout's games from the corpus of that time (239 of 869), so readings of
 * the hand doubles table there lean its way.
 */
export const HOLDOUT_MANIFEST = 'regression/fixtures/fit-holdout-manifest.json';
export const FIT_MANIFEST = 'regression/fixtures/fit-corpus-manifest.json';

export interface BankUniverse {
  ids: string[];
  trancheOf: Map<string, string>;
  /** The replays come from the fit corpus's disk cache (.fit-corpus/), not from the network. */
  cached: boolean;
  /** The sampled turns of a replay with maxTurn snapshots. */
  sampleTurns(maxTurn: number): number[];
}

/** The phase of a sampled turn: the third of the game it falls in (turn / maxTurn). */
export function phaseOf(turn: number, maxTurn: number): 'early' | 'mid' | 'late' {
  const fraction = turn / maxTurn;
  return fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'mid' : 'late';
}

/** The bank's standing rule: every ceil(maxTurn / 8)-th turn from turn 2. */
export function bankTurns(maxTurn: number): number[] {
  const step = Math.max(1, Math.ceil(maxTurn / 8));
  const turns: number[] = [];
  for (let turn = 2; turn < maxTurn; turn += step) turns.push(turn);
  return turns;
}

/**
 * Round 65: three turns per holdout game, one in each third of the game
 * (the bank's phases), so the holdout buys its power with games: positions
 * of one game share their outcome, a fourth position adds little.
 * Round 66: each turn is the one nearest the middle of its third among the
 * sampleable turns (from turn 2) inside that third; a short game drops the
 * thirds it has no such turn in. Before, a game of five or six snapshots
 * clamped its early point to turn 2, which reads as mid.
 */
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

/** The holdout's sets as written by scripts/build-fit-holdout.mjs. */
export function holdoutSets(): { key: string; family: string; ids: string[] }[] {
  return (JSON.parse(readFileSync(HOLDOUT_MANIFEST, 'utf-8')) as { sets: { key: string; family: string; ids: string[] }[] }).sets;
}

/**
 * Round 69 (T163): EVAL_CALIBRATION_FAMILY=<family> narrows the fit corpus to one family of
 * fit-families.ts (standard-singles, standard-doubles, vgc-doubles, champions-singles,
 * champions-doubles) and leaves out what a fit leaves out, the holdout and the ladder games
 * without a rating, so a search capture does not pay for rows its report drops.
 */
/** A ladder game a fit reads: it has a rating, or the cache lacks it (the run skips that game). */
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

/**
 * Round 69 (T163): EVAL_CALIBRATION_TURNS=thirds samples a game at the holdout's turns, one in
 * each third of the game, on any source. Without it every source keeps its own rule.
 */
function turnRule(own: (maxTurn: number) => number[]): (maxTurn: number) => number[] {
  const rule = process.env.EVAL_CALIBRATION_TURNS;
  if (rule === undefined || rule === '') return own;
  if (rule !== 'thirds') throw new Error(`unknown EVAL_CALIBRATION_TURNS ${rule} (thirds)`);
  return holdoutTurns;
}

/**
 * The universe of a run. Default: the bank's tranches (`bank`), fetched
 * from the network. EVAL_CALIBRATION_SOURCE=fit swaps in the
 * manifest-pinned weight-fitting corpus from its disk cache: FIT-SIDE DUMPS
 * ONLY, since those games trained the winprob K and the feature weights, so
 * their numbers must never be quoted as calibration records (hence the
 * dump-path guard; the tranche labels fit-tournament / fit-ladder keep
 * provenance loud). EVAL_CALIBRATION_SOURCE=holdout reads the corpus's
 * holdout instead, one third of its doubles and Champions sets that every
 * fit drops (regression/eval-fit.spec.ts), tranche holdout-<family>, up to
 * three positions per game (holdoutTurns). The universes never mix ids.
 * EVAL_CALIBRATION_FAMILY and EVAL_CALIBRATION_TURNS (round 69) narrow the fit corpus to one family and
 * thin the turns to one per third of a game; without them nothing moves.
 */
export function bankUniverse(bank: { ids: string[]; trancheOf: Map<string, string> }): BankUniverse {
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
