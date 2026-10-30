import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { buildTeamsFromReplay, parseReplayLogWithObservations, getBranchSimulatorFormat, type ReplayData } from '@fulllifegames/replay-core';
import { serializeLiveBattle, type ReplacementPoint } from '@fulllifegames/eval-engine';
import { reconstructReplayRuntime } from '../../src/lib/eval-acquire';
import { handleReplayJob } from '../../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse } from '../../src/lib/replay-jobs/types';

/**
 * Round 79 (T290): the replay worker hands out the open replacement requests of the knockouts when the job asks, and they are
 * the main thread's, byte for byte. A job that does not ask gets none, and the positions stay as they were either way.
 */

const FIXTURES = [
  { kind: 'singles', file: 'gen9ou-2658662321' },
  { kind: 'doubles', file: 'gen9doublesou-2694811367' },
];

const load = (file: string) =>
  JSON.parse(readFileSync(`packages/eval-engine/test/fixtures/${file}.json`, 'utf-8')) as ReplayData;

describe('replay jobs: the replacement requests', () => {
  test.each(FIXTURES)('$kind: the worker hands out the main thread\'s points, and none unless asked', { timeout: 300000 }, async ({ file }) => {
    const replay = load(file);
    const target = (replay.log.match(/^\|turn\|/gm)?.length ?? 1) + 2;
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const format = getBranchSimulatorFormat(replay);

    const direct: { point: ReplacementPoint; serialized: string }[] = [];
    const directPositions = new Map<number, string>();
    await reconstructReplayRuntime({
      replayData: replay, p1Team, p2Team, targetTurn: target, snapshots, observations, onProgress: () => {},
      onPosition: (turn, battle) => directPositions.set(turn, serializeLiveBattle(battle)),
      onReplacement: (point, battle) => direct.push({ point, serialized: serializeLiveBattle(battle) }),
    });
    expect(direct.length).toBeGreaterThan(0);

    const run = async (replacements: boolean) => {
      const responses: ReplayJobResponse[] = [];
      await handleReplayJob({
        type: 'reconstruct', id: 5,
        job: { format, p1Team, p2Team, replayLog: replay.log, targetTurn: target, snapshots, observations, mode: 'replay',
          playerNames: [replay.players[0], replay.players[1]], ...(replacements ? { replacements: true } : {}) },
      }, response => responses.push(response));
      return responses;
    };
    const asked = await run(true);
    const points = asked.flatMap(response => (response.type === 'replayReplacement' ? [{ point: response.point, serialized: response.serialized }] : []));
    expect(points).toEqual(direct);
    const positions = asked.flatMap(response => (response.type === 'replayPosition' ? [[response.turn, response.serialized] as const] : []));
    expect(new Map(positions)).toEqual(directPositions);

    const plain = await run(false);
    expect(plain.some(response => response.type === 'replayReplacement')).toBe(false);
    expect(plain.flatMap(response => (response.type === 'replayPosition' ? [[response.turn, response.serialized] as const] : []))).toEqual(positions);
    expect(plain.some(response => response.type === 'replayError')).toBe(false);
  });
});
