import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { generateReplayHtml } from '../../src/lib/replay-html';
import { branchFrameLog } from '../../src/lib/branch-log';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';

/**
 * Round 82 (forced dice), step A7b, decision 6a: the replay client prints the display line of a forced die (a `|-message|` line the
 * branch log carries, `src/lib/branch-dice-lines.ts`) right where the die decided, and the frozen /v1.0.2/ viewer plays the same
 * client. The page is the branch frame's own HTML on a real log with one message line put after the first move of turn 2.
 */
test.beforeAll(installReplayEmbedCache);

const TEXT = 'Forced: Air Slash flinch, 60 %';

test('the replay client prints the display line of a forced die after the move that drew it', async ({ page }) => {
  await routeOfflineFixtures(page);
  const replay = JSON.parse(readFileSync(new URL('../e2e-feedback/fixtures/smogtours-gen8ou-573756.json', import.meta.url), 'utf-8')) as {
    log: string; format: string; players: string[];
  };
  const lines = replay.log.split('\n');
  const turn2 = lines.indexOf('|turn|2');
  const turn3 = lines.indexOf('|turn|3');
  const firstMove = lines.findIndex((line, index) => index > turn2 && line.startsWith('|move|'));
  const log = branchFrameLog(lines.slice(0, turn3 + 1), [{ at: firstMove + 1, text: TEXT }]);
  await page.setContent(generateReplayHtml({ log, format: replay.format, p1: replay.players[0], p2: replay.players[1], seekTurn: 3, autoPlay: false }));
  const entries = () => page.evaluate(() => [...document.querySelectorAll('.battle-log .battle-history')].map(entry => entry.textContent ?? ''));
  await expect.poll(async () => (await entries()).includes(TEXT), { timeout: 60_000 }).toBe(true);
  // the line stands right after the move's own line, before what the move did
  const shown = await entries();
  expect(shown[shown.indexOf(TEXT) - 1]).toMatch(/ used .+!$/);
  expect(shown.filter(entry => entry === TEXT)).toHaveLength(1);
});
