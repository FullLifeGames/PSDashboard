import { beforeAll, describe, expect, test } from 'vitest';
import { getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { rolledCopy } from '@fulllifegames/eval-engine';
import { handleReplayJob } from '../../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse, RolledCopyJob } from '../../src/lib/replay-jobs/types';
import { rebuild, type FixtureId, type Rebuilt } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B6 (T304): the replay worker plays the copy of a turn with the biggest roll's die
 * turned over, where the simulator is loaded (the sweep's last stage asks it once per replay with a named roll). The worker's answer is
 * the engine's copy, byte for byte, reduced to what the evaluation needs: the position of the next root, where the copy stands, and the
 * score of a game that ends in it. A roll the log does not show as a miss is an answer of null, never an error.
 */

const SCENES: { id: FixtureId; turn: number; roll: RolledCopyJob['roll']; stage: 'request' | 'ended'; terminal: number | null }[] = [
  { id: 'smogtours-gen8ou-573756', turn: 73, roll: { side: 'p2', move: 'Fire Fang' }, stage: 'request', terminal: null },
  { id: 'gen9vgc2026regi-2629703929', turn: 10, roll: { side: 'p2', move: 'Precipice Blades', target: 'Koraidon', slot: 0 }, stage: 'ended', terminal: -1 },
];

const rebuilt = new Map<FixtureId, Rebuilt>();
beforeAll(async () => {
  for (const scene of SCENES) rebuilt.set(scene.id, await rebuild(scene.id));
}, 300_000);

const jobFor = (id: FixtureId, turn: number, roll: RolledCopyJob['roll']): RolledCopyJob => {
  const built = rebuilt.get(id)!;
  return { format: getBranchSimulatorFormat(built.replay), replayLog: built.replay.log, position: built.positions.get(turn)!, turn, roll };
};

async function run(job: RolledCopyJob): Promise<ReplayJobResponse[]> {
  const responses: ReplayJobResponse[] = [];
  await handleReplayJob({ type: 'rolledCopy', id: 7, job }, response => responses.push(response));
  return responses;
}

describe('replay jobs: the copy of a turn with its biggest roll turned over', () => {
  test.each(SCENES)('$id turn $turn: the worker answers with the engine\'s copy', async scene => {
    const job = jobFor(scene.id, scene.turn, scene.roll);
    const responses = await run(job);
    expect(responses).toHaveLength(1);
    const [response] = responses;
    expect(response.type).toBe('rolledCopyResult');
    const direct = rolledCopy({ position: job.position, replayLog: job.replayLog, turn: job.turn, roll: job.roll });
    expect(direct).not.toBeNull();
    if (response.type !== 'rolledCopyResult') return;
    expect(response.id).toBe(7);
    expect(response.outcome).toEqual({ serialized: direct!.serialized, stage: scene.stage, terminal: scene.terminal });
  });

  test('a roll the log does not show as a miss is an answer of null, not an error', async () => {
    const responses = await run(jobFor('smogtours-gen8ou-573756', 73, { side: 'p2', move: 'Thunder Fang' }));
    expect(responses).toEqual([{ type: 'rolledCopyResult', id: 7, outcome: null }]);
  });
});
