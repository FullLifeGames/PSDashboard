import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { handleReplayJob } from '../../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse } from '../../src/lib/replay-jobs/types';

/**
 * Round 75 (T160, step 3): the spread solve of the replay worker builds the teams from the log's tier line, which a Champions game
 * reads on the registered Champions Dex. A fresh worker has none; the job registers the mod itself. Own spec file, because this
 * realm registers the mod once (the reconstruction job's spec is replay-jobs-mod.spec.ts).
 */
const DOUBLES = JSON.parse(readFileSync('packages/eval-engine/test/fixtures/champions/gen9championsvgc2026regmbbo3-2679053861.json', 'utf8')) as ReplayData;

test('a Champions spread solve registers the mod before its first read', async () => {
  expect(Dex.dexes.champions).toBeUndefined();
  const { observations, speedOrders } = parseReplayLogWithObservations(DOUBLES.log);
  expect(observations.length + speedOrders.length).toBeGreaterThan(0);
  const responses: ReplayJobResponse[] = [];
  await handleReplayJob({
    type: 'solveSpreads', id: 1,
    job: { log: DOUBLES.log, observations, speedOrders, p1Info: null, p2Info: null, usageStats: null, setAssumptions: null },
  }, response => responses.push(response));
  expect(responses.map(response => (response.type === 'replayError' ? response.message : response.type))).toEqual(['solveSpreadsResult']);
  expect(Dex.dexes.champions).toBeDefined();
});
