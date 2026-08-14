import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FEEDBACK_CORPUS, FEEDBACK_REPLAYS } from '../e2e-feedback/corpus';
import { validateCorpus } from '../e2e-feedback/claims';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { finalPlayedTurn } from '../src/lib/replay-turns';

/**
 * The committed feedback fixtures must stay parseable and long enough for
 * every corpus turn — the cheap, always-on half of the drift harness.
 */
test('feedback fixtures parse and cover every corpus turn', () => {
  const turnsByReplay: Record<string, number> = {};
  for (const id of FEEDBACK_REPLAYS) {
    const replay = JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as { id: string; log: string; players: string[] };
    expect(replay.id).toBe(id);
    expect(replay.players.length).toBeGreaterThanOrEqual(2);
    const { snapshots } = parseReplayLogWithObservations(replay.log);
    expect(snapshots.length).toBeGreaterThan(0);
    turnsByReplay[id] = finalPlayedTurn(snapshots);
    expect(turnsByReplay[id]).toBeGreaterThanOrEqual(10);
  }
  expect(validateCorpus(FEEDBACK_CORPUS, turnsByReplay, false)).toEqual([]);
});
