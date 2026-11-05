import { allTurnEvents, parseTendencies, type BiggestRoll } from '@fulllifegames/eval-engine';
import { getBranchSimulatorFormat, getReplayGeneration, type GameRules, type ReplayData, type TurnSnapshot } from '@fulllifegames/replay-core';
import { buildAnalysisContext, namedRollOf, type AnalysisGraphData } from './analysis-context';
import { engineCacheTag } from './eval/engine-setting';
import { ReplayWorkerClient } from './replay-jobs/client';
import type { RolledCopyJob, RolledCopyOutcome } from './replay-jobs/types';

/**
 * Round 86 (T304): the app's half of the sweep's biggest-roll stage (hooks/evaluation/sweep-rolled.ts). The report's own walk names the
 * roll over the sweep's arrays; the replay worker plays the copy of its turn, where the simulator is loaded, in a worker of its own that
 * lives for the one call (a replay with a named roll pays one call, one without pays none); the copy's evaluation is cached under a key
 * beside the turn keys of the replay.
 */

/** What the app hands the sweep's stage: the report's roll over the graph, the worker's copy, and the cache key of the copy's evaluation. */
export interface RolledCopyParams {
  /** The report's biggest roll over the swept graph (the walk the report makes), or null where it names none. */
  namedRoll(graph: AnalysisGraphData): BiggestRoll | null;
  /** The turn with the roll's die turned over, played where the simulator is loaded; null where the log shows no such miss. */
  playCopy(roll: BiggestRoll, position: string): Promise<RolledCopyOutcome | null>;
  keyFor(turn: number): string;
}

/** The roll in the report's words, for the worker to find its die in the log. */
export const selectorOf = (roll: BiggestRoll): RolledCopyJob['roll'] => ({
  side: roll.winner, move: roll.move,
  ...(roll.target !== undefined ? { target: roll.target } : {}),
  ...(roll.slot !== undefined ? { slot: roll.slot } : {}),
});

export function rolledCopyParams(args: {
  replayData: ReplayData;
  snapshots: TurnSnapshot[];
  rules: GameRules;
  setsFingerprint: string;
  /** A test hands in a fake worker. */
  makeClient?: () => Pick<ReplayWorkerClient, 'rolledCopy' | 'dispose'>;
}): RolledCopyParams {
  const { replayData, snapshots, rules, setsFingerprint, makeClient = () => new ReplayWorkerClient() } = args;
  // The walk reads the replay's own events and tendencies, which do not change with the sweep: read them once.
  let replay: Pick<Parameters<typeof namedRollOf>[0], 'tendencies'> & { turnEventsIndex: string[][] } | null = null;
  const replayOnce = () => (replay ??= {
    turnEventsIndex: allTurnEvents(replayData.log),
    tendencies: { p1: parseTendencies(replayData.log, 'p1'), p2: parseTendencies(replayData.log, 'p2') },
  });
  return {
    namedRoll: graph => {
      const { turnEventsIndex, tendencies } = replayOnce();
      const context = buildAnalysisContext({
        snapshots, turnEventsIndex, graphPlayed: graph.played, replayGen: getReplayGeneration(replayData), mod: rules.mod,
      });
      return namedRollOf({ replayData, graph, context, tendencies });
    },
    playCopy: async (roll, position): Promise<RolledCopyOutcome | null> => {
      const client = makeClient();
      try {
        return await client.rolledCopy({
          format: getBranchSimulatorFormat(replayData), replayLog: replayData.log, position, turn: roll.turn, roll: selectorOf(roll),
        });
      } finally {
        client.dispose();
      }
    },
    keyFor: turn => `${replayData.id}:${turn}x:${setsFingerprint}${engineCacheTag()}`,
  };
}
