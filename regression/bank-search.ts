import {
  AUTO_MCTS_FAINTED_FRACTION, createLocalTreeExecutor, parsePlayedActions, parsePlayedActionsDoubles, resolveTeraPreference,
  searchPosition, searchTreesOrchestrated,
  type EvalResult, type EvalSettings, type TeraAllowance,
} from '@fulllifegames/eval-engine';
import { formatEnforcesSleepClause, getBranchSimulatorFormat, inferReplayFormatId } from '@fulllifegames/replay-core';

/**
 * Round 61: the bank's search, the app's dispatch. Below the auto threshold
 * the sync matrix search (parity with the app's orchestrated matrix is
 * pinned by eval-orchestrator.spec.ts); at or above it the app's tree
 * search (searchTreesOrchestrated: four trees, verify, prover) over an
 * in-process executor. Before round 61 the bank ran one tree without
 * verify (mctsSearch).
 */
export interface BankSearchInput {
  serialized: string;
  faintedFraction: number;
  depth: 1 | 2 | 3;
  samples: 1 | 3 | 5;
  /** EVAL_CALIBRATION_MODE: 'auto' mirrors the app, 'mcts' forces the tree, anything else the matrix. */
  mode: string | undefined;
  settings: Omit<EvalSettings, 'depth' | 'samples' | 'mode'>;
}

export function bankSearch(input: BankSearchInput): Promise<EvalResult> {
  const { serialized, faintedFraction, depth, samples, mode, settings } = input;
  const tree = mode === 'mcts' || (mode === 'auto' && faintedFraction >= AUTO_MCTS_FAINTED_FRACTION);
  if (tree) return searchTreesOrchestrated(createLocalTreeExecutor(serialized), { ...settings, depth: 1, samples: 1, mode: 'mcts' });
  return Promise.resolve(searchPosition(serialized, { ...settings, depth, samples }));
}

/**
 * The app's format switches for one replay (useEvalView useEvalFormat): Tera
 * with the default preference 'auto' (none without a click, everyone on the
 * ladder, only the species that clicked in draft and custom formats), Sleep
 * Clause from the branch format.
 */
export function bankSettings(replay: { id?: string; formatid?: string; log: string }): { tera: TeraAllowance; sleepClause: boolean } {
  return {
    tera: resolveTeraPreference('auto', inferReplayFormatId(replay), replay.log),
    sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)),
  };
}

/** The app sweep's keepPlayed (sweep-core.ts with useEvalView playedFor): the actions in snapshot[turn]'s log, kept when a slot was played. */
export function bankKeepPlayed(snapshotLogs: (string[] | undefined)[], turn: number, doubles: boolean): EvalSettings['keepPlayed'] {
  const lines = snapshotLogs[turn] ?? [];
  const played = doubles ? parsePlayedActionsDoubles(lines) : parsePlayedActions(lines);
  return played.p1Slots || played.p2Slots ? played : undefined;
}

/** EVAL_CALIBRATION_SAMPLES: the engine has five fixed seeds; another count would draw an unseeded PRNG. */
export function bankSampleCount(raw: string | undefined): 1 | 3 | 5 {
  const count = raw === undefined || raw === '' ? 1 : Number(raw);
  if (count !== 1 && count !== 3 && count !== 5) throw new Error(`EVAL_CALIBRATION_SAMPLES must be 1, 3 or 5, got ${raw}`);
  return count;
}
