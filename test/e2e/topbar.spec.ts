import { test, expect, type Page } from '@playwright/test';
import { dockReplays, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { failOnResizeLoops, lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 84 (A7f, ruling 19a): the top bar stays on one line with a long format name. The user's game was a Champions VGC replay
 * ("[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)", SpiringOcean against sigueinventando): the support links wrapped to a second line
 * because the match took its whole text as its basis. Now the match takes what the menus and links leave, the format tag shortens
 * first with an ellipsis and holds its full name in a title, and the player names shorten only after it. The fixture is the Champions
 * VGC corpus game with its `format` and `players` replaced; the rules still come from its `formatid` and log.
 */
const ID = 'gen9championsvgc2026regma-2625939941';
const FORMAT = '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)';
const PLAYERS = ['SpiringOcean', 'sigueinventando'];

test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);

async function loadLongNames(page: Page): Promise<void> {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  const replay = dockReplays.find(candidate => candidate.id === ID)!;
  // The last route registered answers first, so this one wins over the offline fixtures' for the same replay.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...replay, format: FORMAT, players: PLAYERS }),
  }));
  await page.goto('/');
  await loadDockReplay(page, ID, 1);
}

for (const viewport of [{ width: 2560, height: 1290 }, { width: 1366, height: 768 }]) {
  test(`${viewport.width} x ${viewport.height}: the bar's children share one line, the tag holds the full name`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await loadLongNames(page);
    const tag = page.locator('.ps-topbar-match .ps-format-tag');
    await expect(tag).toHaveText(FORMAT);
    await expect(tag).toHaveAttribute('title', FORMAT);
    const names = page.locator('.ps-topbar-match .ps-player');
    await expect(names).toHaveCount(2);
    for (const [index, name] of PLAYERS.entries()) await expect(names.nth(index)).toHaveAttribute('title', name);

    const facts = await page.evaluate(() => {
      const bar = document.querySelector('.ps-topbar') as HTMLElement;
      const rects = [...bar.children].map(child => child.getBoundingClientRect());
      const clipped = (selector: string) => [...bar.querySelectorAll<HTMLElement>(selector)].map(element => element.scrollWidth > element.clientWidth + 1);
      return {
        count: rects.length, tops: rects.map(rect => rect.top), bottoms: rects.map(rect => rect.bottom),
        tagClipped: clipped('.ps-format-tag')[0], namesClipped: clipped('.ps-player'),
      };
    });
    const message = JSON.stringify(facts);
    expect(facts.count, message).toBeGreaterThanOrEqual(3);
    // One line: a horizontal line through the bar crosses every child.
    expect(Math.max(...facts.tops), `the bar's children share one line ${message}`).toBeLessThan(Math.min(...facts.bottoms));
    // The tag gives way first: while it clips, the names stay whole.
    if (facts.tagClipped) expect(facts.namesClipped, `the names stay whole while the tag clips ${message}`).toEqual([false, false]);
  });
}
