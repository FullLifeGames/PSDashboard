import { allTurnEvents, parseTendencies, type BiggestRoll } from '@fulllifegames/eval-engine';
import { getBranchSimulatorFormat, getReplayGeneration, type GameRules, type ReplayData, type TurnSnapshot } from '@fulllifegames/replay-core';
import { buildAnalysisContext, namedRollOf, type AnalysisGraphData } from './analysis-context';
import { engineCacheTag } from './eval/engine-setting';
import { ReplayWorkerClient } from './replay-jobs/client';
import type { RolledCopyJob, RolledCopyOutcome } from './replay-jobs/types';


export interface RolledCopyParams {
  namedRoll(graph: AnalysisGraphData): BiggestRoll | null;
  playCopy(roll: BiggestRoll, position: string): Promise<RolledCopyOutcome | null>;
  keyFor(turn: number): string;
}

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
  makeClient?: () => Pick<ReplayWorkerClient, 'rolledCopy' | 'dispose'>;
}): RolledCopyParams {
  const { replayData, snapshots, rules, setsFingerprint, makeClient = () => new ReplayWorkerClient() } = args;
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
