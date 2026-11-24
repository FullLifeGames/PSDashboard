import { test, expect, describe, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay,
  solveReplaySpreads,
  parseReplayLogWithObservations,
  getBranchSimulatorFormat,
  type ReplayData,
} from '@fulllifegames/replay-core';
import { serializeLiveBattle, type ReplacementPoint, rolledCopy } from '@fulllifegames/eval-engine';
import { reconstructReplayRuntime } from '../../src/lib/eval-acquire';
import { handleReplayJob } from '../../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse, RolledCopyJob } from '../../src/lib/replay-jobs/types';
import { rebuild, type FixtureId, type Rebuilt } from './forced-reconstruction-support';

const TARGET = 20;

function loadDraftReplay(): ReplayData {
  return JSON.parse(readFileSync('test/e2e/fixtures/draft-replay.json', 'utf-8')) as ReplayData;
}

describe('replay jobs in the worker', () => {
  test('reconstruct hands out the same positions, log, and verdicts as the main-thread path', { timeout: 300000 }, async () => {
    const replay = loadDraftReplay();
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const format = getBranchSimulatorFormat(replay);

    const direct = new Map<number, string>();
    const { runtime, branchEngine } = await reconstructReplayRuntime({
      replayData: replay, p1Team, p2Team, targetTurn: TARGET, snapshots, observations,
      onProgress: () => {},
      onPosition: (turn, battle) => direct.set(turn, serializeLiveBattle(battle)),
    });
    const directBattle = runtime.battleStream.battle!;
    const directFinal = serializeLiveBattle(directBattle);

    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'reconstruct', id: 7,
      job: { format, p1Team, p2Team, replayLog: replay.log, targetTurn: TARGET, snapshots, observations, mode: 'replay',
        playerNames: [replay.players[0], replay.players[1]] },
    }, response => responses.push(response));

    const positions = responses.filter(response => response.type === 'replayPosition');
    expect(positions.map(position => position.turn)).toEqual([...direct.keys()]);
    for (const position of positions) expect(position.serialized).toBe(direct.get(position.turn));

    const result = responses.find(response => response.type === 'reconstructResult');
    expect(result?.type).toBe('reconstructResult');
    if (result?.type !== 'reconstructResult') return;
    expect(result.outcome.serialized).toBe(directFinal);
    expect(result.outcome.log).toEqual(runtime.log);
    expect(result.outcome.reached).toBe(branchEngine.reconstructionReached(runtime, TARGET));
    expect(result.outcome.invalid).toBe(branchEngine.validateBranchRuntime(runtime));
    expect(result.outcome.turn).toBe(directBattle.turn);
    expect(result.outcome.ended).toBe(directBattle.ended);
    expect(result.outcome.haxAlignment).toEqual(runtime.haxAlignment);
    expect(responses.some(response => response.type === 'replayProgress')).toBe(true);
    expect(responses.some(response => response.type === 'replayError')).toBe(false);
  });

  test('solveSpreads hands out the same map as solveReplaySpreads', { timeout: 120000 }, async () => {
    const replay = loadDraftReplay();
    const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const direct = solveReplaySpreads(replay.log, observations, { speedOrders });
    expect(direct.size).toBeGreaterThan(0);

    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'solveSpreads', id: 3,
      job: { log: replay.log, observations, speedOrders, p1Info: null, p2Info: null, usageStats: null, setAssumptions: null },
    }, response => responses.push(response));
    const result = responses[0];
    expect(result.type).toBe('solveSpreadsResult');
    if (result.type !== 'solveSpreadsResult') return;
    expect(result.entries).toEqual([...direct.entries()]);
  });

  test('a failing job answers with an error message instead of throwing', async () => {
    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'reconstruct', id: 9,
      job: { format: 'gen9ou', p1Team: [], p2Team: [], replayLog: '', targetTurn: 1, snapshots: [], observations: [], mode: 'replay' },
    }, response => responses.push(response));
    const last = responses[responses.length - 1];
    expect(last.type === 'replayError' || last.type === 'reconstructResult').toBe(true);
  });
});

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

describe('replay-jobs-rolled-copy', () => {
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
});
