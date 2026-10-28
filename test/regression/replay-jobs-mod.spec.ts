import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { getBranchSimulatorFormat, type ReplayData } from '@fulllifegames/replay-core';
import { handleReplayJob } from '../../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse } from '../../src/lib/replay-jobs/types';

/**
 * Round 75 (T160, step 3): the replay worker is its own realm. The app loads the Champions mod on the main thread (loadReplayMods),
 * but a worker instance has its own module registry and its own simulator, with no mod. Its reconstruction job builds the
 * choice-lock context from the log's tier line before anything else loads the mod; round 75's first build answered it with "The
 * Pokémon Champions mod is not registered" and the app analyzed no turn of a Champions replay. This spec runs in its own module
 * registry, so the mod is unregistered at its start, as in a fresh worker. The solve job has its own spec
 * (replay-jobs-mod-solve.spec.ts), because one realm registers the mod once.
 */
const fixture = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as ReplayData;
const SINGLES = fixture('packages/eval-engine/test/fixtures/champions/gen9championsou-2693832490.json');
const DOUBLES = fixture('packages/eval-engine/test/fixtures/champions/gen9championsvgc2026regmbbo3-2679053861.json');

test('a Champions reconstruction registers the mod before its first read (doubles, then singles)', async () => {
  expect(Dex.dexes.champions).toBeUndefined();
  for (const replay of [DOUBLES, SINGLES]) {
    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'reconstruct', id: 2,
      job: {
        format: getBranchSimulatorFormat(replay), p1Team: [], p2Team: [], replayLog: replay.log, targetTurn: 3, snapshots: [],
        observations: [], mode: 'replay',
      },
    }, response => responses.push(response));
    const errors = responses.flatMap(response => (response.type === 'replayError' ? [response.message] : []));
    expect(errors.join(' ')).not.toMatch(/Champions mod is not registered/);
    expect(Dex.dexes.champions).toBeDefined();
  }
});
