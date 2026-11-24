import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplayData } from '@fulllifegames/replay-core';
import { deserializeBattleExact } from '@fulllifegames/eval-engine';
import { makePreviewAcquire, type TeamBuildSources } from '../../../src/lib/eval-acquire';

// vitest gives this file a module graph of its own: eval-acquire must load the Champions mod itself.
const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', name), 'utf-8')) as T;
const replay = fixture<{ id: string; format: string; formatid: string; players: string[]; log: string }>('gen9championsou-2693832490.json');
const replayData: ReplayData = { ...replay, uploadtime: 0, views: 0 };

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

describe('the main thread loads the Champions mod before a Champions battle', () => {
  test('the turn-0 preview of a Champions replay plays on the Champions mod', async () => {
    const serialized = await makePreviewAcquire(replayData, sources, null)();
    expect(serialized).not.toBeNull();
    const battle = deserializeBattleExact(serialized!);
    expect(battle.format.id).toBe('gen9championsou');
    expect(battle.dex.currentMod).toBe('champions');
  }, 60_000);
});
