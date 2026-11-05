import { beforeEach, describe, expect, test } from 'vitest';
import { getBranchSimulatorFormat, logRules } from '@fulllifegames/replay-core';
import type { BiggestRoll } from '@fulllifegames/eval-engine';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';
import { rolledCopyParams } from '../../../src/lib/rolled-copy-stage';
import type { RolledCopyJob, RolledCopyOutcome } from '../../../src/lib/replay-jobs/types';

/**
 * Round 86 (T304): the app's half of the sweep's biggest-roll stage. The replay worker plays the copy of the roll's turn (one worker, spawned
 * for the one call and ended after it), the job carries the roll in the report's words, and the cache key of the copy's evaluation sits
 * beside the turn keys of the replay. The roll itself is the report's (`namedRollOf`, tested with the walk).
 */

const { replayData, snapshots } = replayFixture('singles');
const FORMAT = getBranchSimulatorFormat(replayData);

const roll: BiggestRoll = { turn: 2, side: 'p1', winner: 'p2', amount: 0.3, move: 'Fire Fang', accuracy: 0.95, after: { score: -0.6 } };
const doublesRoll: BiggestRoll = { ...roll, move: 'Precipice Blades', target: 'Koraidon', slot: 0 };
const outcome: RolledCopyOutcome = { serialized: 'copy', stage: 'request', terminal: null };

class FakeClient {
  jobs: RolledCopyJob[] = [];
  disposed = 0;
  answer: RolledCopyOutcome | null | Error = outcome;
  async rolledCopy(job: RolledCopyJob) {
    this.jobs.push(job);
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
  dispose() {
    this.disposed += 1;
  }
}

let client: FakeClient;
const stageOf = () => rolledCopyParams({
  replayData, snapshots, rules: logRules(replayData.log), setsFingerprint: 'fp1', makeClient: () => client,
});

beforeEach(() => {
  client = new FakeClient();
});

describe('the app\'s half of the biggest-roll stage', () => {
  test('the worker gets the replay\'s log, the turn\'s start position and the roll in the report\'s words; singles name no target or slot', async () => {
    const copy = await stageOf().playCopy(roll, 'position-2');
    expect(copy).toEqual(outcome);
    expect(client.jobs).toEqual([{
      format: FORMAT, replayLog: replayData.log, position: 'position-2', turn: 2, roll: { side: 'p2', move: 'Fire Fang' },
    }]);
  });

  test('a doubles click carries its target body and the attacker\'s slot', async () => {
    await stageOf().playCopy(doublesRoll, 'position-2');
    expect(client.jobs[0].roll).toEqual({ side: 'p2', move: 'Precipice Blades', target: 'Koraidon', slot: 0 });
  });

  test('the worker lives for the one call: it ends after an answer, an empty answer and a failure alike', async () => {
    const stage = stageOf();
    await stage.playCopy(roll, 'position-2');
    client.answer = null;
    expect(await stage.playCopy(roll, 'position-2')).toBeNull();
    client.answer = new Error('replay worker crashed');
    await expect(stage.playCopy(roll, 'position-2')).rejects.toThrow('crashed');
    expect(client.disposed).toBe(3);
  });

  test('the copy\'s evaluation is cached beside the turn keys of the replay', () => {
    expect(stageOf().keyFor(2)).toMatch(new RegExp(`^${replayData.id}:2x:fp1`));
    expect(stageOf().keyFor(2)).not.toBe(stageOf().keyFor(3));
  });

  test('the roll is the report\'s: a graph of plain turns names none', () => {
    const scores = evalGraph('singles').scores.slice(0, snapshots.length);
    const graph = {
      scores, results: scores.map(score => evalResult('singles', { score })), turnSettings: scores.map(() => null),
      faintedFractions: scores.map(() => null), played: scores.map(() => null), playedOutcome: scores.map(() => null),
      verified: scores.map(() => null), sensitivity: scores.map(() => null), evalErrors: scores.map(() => null),
      lead: null, replacements: scores.map(() => null), rollFlip: null, notice: null,
    };
    expect(stageOf().namedRoll(graph)).toBeNull();
  });
});

