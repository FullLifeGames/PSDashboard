import { readFileSync } from 'node:fs';

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
 */
export function holdoutTurns(maxTurn: number): number[] {
  const turns = [1 / 6, 1 / 2, 5 / 6].map(at => Math.min(maxTurn - 1, Math.max(2, Math.round(at * maxTurn))));
  return [...new Set(turns)].filter(turn => turn < maxTurn);
}

/** The holdout's sets as written by scripts/build-fit-holdout.mjs. */
export function holdoutSets(): { key: string; family: string; ids: string[] }[] {
  return (JSON.parse(readFileSync(HOLDOUT_MANIFEST, 'utf-8')) as { sets: { key: string; family: string; ids: string[] }[] }).sets;
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
 * fit drops (regression/eval-fit.spec.ts), tranche holdout-<family>, three
 * positions per game. The universes never mix ids.
 */
export function bankUniverse(bank: { ids: string[]; trancheOf: Map<string, string> }): BankUniverse {
  const source = process.env.EVAL_CALIBRATION_SOURCE;
  if (source === 'holdout') {
    const sets = holdoutSets();
    return {
      ids: sets.flatMap(set => set.ids),
      trancheOf: new Map(sets.flatMap(set => set.ids.map(id => [id, `holdout-${set.family}`] as const))),
      cached: true,
      sampleTurns: holdoutTurns,
    };
  }
  if (source === undefined || source === '') return { ...bank, cached: false, sampleTurns: bankTurns };
  if (source !== 'fit') throw new Error(`unknown EVAL_CALIBRATION_SOURCE ${source} (fit or holdout)`);
  if (!process.env.EVAL_CALIBRATION_DUMP) {
    throw new Error('EVAL_CALIBRATION_SOURCE=fit produces fit-side dumps only — set EVAL_CALIBRATION_DUMP');
  }
  const { replays } = JSON.parse(readFileSync(FIT_MANIFEST, 'utf-8')) as { replays: { id: string; source: 'tournament' | 'ladder' }[] };
  return {
    ids: replays.map(entry => entry.id),
    trancheOf: new Map(replays.map(entry => [entry.id, `fit-${entry.source}`])),
    cached: true,
    sampleTurns: bankTurns,
  };
}
