import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { handleReplayJob } from '../../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse } from '../../src/lib/replay-jobs/types';

// A fresh worker has no Champions mod and the job registers it; a realm registers it once, so this spec stands alone.
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
