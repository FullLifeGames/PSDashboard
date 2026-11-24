import {
  autoTurnSettings, createLocalTreeExecutor, parsePlayedActions, parsePlayedActionsDoubles, resolveTeraPreference,
  searchPosition, searchTreesOrchestrated,
  type EvalResult, type EvalSettings, type StaticRuleset, type TeraAllowance,
} from '@fulllifegames/eval-engine';
import { formatEnforcesSleepClause, getBranchSimulatorFormat, inferReplayFormatId, replayRuleset, type GameRules } from '@fulllifegames/replay-core';

export interface BankSearchInput {
  serialized: string;
  faintedFraction: number;
  depth: 1 | 2 | 3;
  samples: 1 | 3 | 5;
  mode: string | undefined;
  settings: Omit<EvalSettings, 'depth' | 'samples' | 'mode'>;
}

const isDoubles = (serialized: string) => (JSON.parse(serialized) as { gameType?: string }).gameType === 'doubles';

export function bankSearch(input: BankSearchInput): Promise<EvalResult> {
  const { serialized, faintedFraction, mode, settings } = input;
  const resolved = mode === 'auto'
    ? autoTurnSettings(faintedFraction, isDoubles(serialized))
    : { depth: input.depth, samples: input.samples, mode: mode === 'mcts' ? 'mcts' as const : 'matrix' as const };
  if (resolved.mode === 'mcts') {
    return searchTreesOrchestrated(createLocalTreeExecutor(serialized, settings.ruleset), { ...settings, depth: 1, samples: 1, mode: 'mcts' });
  }
  return Promise.resolve(searchPosition(serialized, { ...settings, depth: resolved.depth, samples: resolved.samples }));
}

export function bankSettings(replay: { id?: string; formatid?: string; log: string }): { tera: TeraAllowance; sleepClause: boolean; ruleset: StaticRuleset } {
  return {
    tera: resolveTeraPreference('auto', inferReplayFormatId(replay), replay.log),
    sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)),
    ruleset: replayRuleset(replay),
  };
}

/** Mirrors the app sweep's keepPlayed (sweep-core.ts, useEvalView playedFor). */
export function bankKeepPlayed(snapshotLogs: (string[] | undefined)[], turn: number, doubles: boolean, rules: GameRules): EvalSettings['keepPlayed'] {
  const lines = snapshotLogs[turn] ?? [];
  const played = doubles ? parsePlayedActionsDoubles(lines) : parsePlayedActions(lines, rules);
  return played.p1Slots || played.p2Slots || played.p1 || played.p2 ? played : undefined;
}

/** EVAL_CALIBRATION_SAMPLES: the engine has five fixed seeds; another count would draw an unseeded PRNG. */
export function bankSampleCount(raw: string | undefined): 1 | 3 | 5 {
  const count = raw === undefined || raw === '' ? 1 : Number(raw);
  if (count !== 1 && count !== 3 && count !== 5) throw new Error(`EVAL_CALIBRATION_SAMPLES must be 1, 3 or 5, got ${raw}`);
  return count;
}
