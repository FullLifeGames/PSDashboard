import { readFileSync } from 'fs';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime, type ReplacementPoint } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { serializeLiveBattle } from '../src/serialize';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 79 (T290): the replacement points of a replay, twice. `reconstructWithPoints` plays the app's reconstruction of a
 * fixture with the capture hook on; the specs hold its points to `replacementRounds`, the same points read from the protocol alone.
 */

export const loadFixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

export interface CapturedPoint { point: ReplacementPoint; serialized: string; serializedAgain: string }

/** The app's reconstruction of a fixture up to `targetTurn` (default: past the last turn), with or without the hook. */
export async function reconstructWithPoints(fixture: string, options: { hook?: boolean; targetTurn?: number } = {}) {
  const replay = loadFixture(fixture);
  // The app's worker loads the game's mod before it builds the sets (round 75).
  await loadSimMods(getBranchSimulatorFormat(replay));
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotAt = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const targetTurn = options.targetTurn ?? (replay.log.match(/^\|turn\|/gm)?.length ?? 1) + 2;
  const positions = new Map<number, string>();
  const points: CapturedPoint[] = [];
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay),
    p1Team, p2Team,
    replayLog: replay.log,
    targetTurn,
    snapshot: snapshotAt(targetTurn),
    playerNames: [replay.players[0], replay.players[1]],
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor: snapshotAt,
      onPosition: (turn, battle) => positions.set(turn, serializeLiveBattle(battle)),
      ...(options.hook === false ? {} : {
        onReplacement: (point, battle) => {
          points.push({ point, serialized: serializeLiveBattle(battle), serializedAgain: serializeLiveBattle(battle) });
        },
      }),
    },
  });
  return { replay, runtime, positions, points, final: serializeLiveBattle(runtime.battleStream.battle!) };
}
