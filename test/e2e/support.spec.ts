import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { installReplayEmbedCache, routeOfflineFixtures, startVariationAt } from './helpers';

test.beforeAll(installReplayEmbedCache);

const packageVersion: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version;

type StateHandle = { capture: () => Promise<Record<string, unknown>>; restore: (state: unknown) => Promise<void> };
type Captured = {
  kind: string; app: { version: string; commit: string }; replay: { id: string };
  builtSets: { p1Team: unknown[]; p2Team: unknown[] } | null;
  variation: { startTurn: number | null; history: unknown[] };
  view: Record<string, unknown>; choices: { draft: { p1: unknown[]; p2: unknown[] } };
};

const capture = (page: Page) => page.evaluate(() => (window as unknown as { __psState: StateHandle }).__psState.capture()) as Promise<Captured>;

/** User gate 28.10.2026 (round 77, "1a 2a 3a 4a 5a", mobile a): the support utilities of a bug report. */
test.describe('support', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('the header carries Beta, Report issue and the creator link before and after a replay loads', async ({ page }) => {
    const header = page.locator('.ps-app-header');
    await expect(header).toContainText('Beta');
    await expect(header.getByRole('button', { name: 'Report issue' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'by Bene (FullLifeGames)' })).toHaveAttribute('href', 'https://fulllifegames.com');
    await expect(page.locator('h1')).toHaveCount(1);

    await page.locator('button', { hasText: 'Load' }).click();
    const links = page.locator('.ps-topbar .ps-support-links');
    await expect(links).toContainText('PS Dashboard');
    await expect(links).toContainText('Beta');
    await expect(links.getByRole('button', { name: 'Report issue' })).toBeVisible();
    await expect(links.getByRole('link', { name: 'by Bene (FullLifeGames)' })).toBeVisible();
  });

  test('Report issue opens a dialog that offers the state file and the filled issue form', async ({ page, context }) => {
    // User request 28.10.2026: a dialog with a download button and a link replaces the tab and the download that the
    // click started by itself.
    await context.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>issue form</p>' }));
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    let opened = 0;
    context.on('page', () => { opened += 1; });
    await page.locator('.ps-topbar').getByRole('button', { name: 'Report issue' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report an issue' });
    await expect(dialog).toBeVisible();
    expect(opened).toBe(0);

    const link = dialog.getByRole('link', { name: 'Open the issue on GitHub' });
    await expect(link).toHaveAttribute('target', '_blank');
    const issue = new URL((await link.getAttribute('href'))!);
    expect(`${issue.origin}${issue.pathname}`).toBe('https://github.com/FullLifeGames/PSDashboard/issues/new');
    expect(issue.searchParams.get('template')).toBe('bug_report.yml');
    expect(issue.searchParams.get('replay')).toBe('https://replay.pokemonshowdown.com/gen9ou-test-123');
    expect(issue.searchParams.get('position')).toBe('T2 in the variation from turn 1 (1 turn)');
    expect(issue.searchParams.get('version')).toMatch(new RegExp(`^${packageVersion.replace(/\./g, '\\.')} \\([0-9a-f]{7,}\\)$`));
    expect(issue.searchParams.get('body')).toContain('T2 in the variation from turn 1 (1 turn)');

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download state file' }).click();
    const file = await download;
    await expect(dialog.getByRole('status')).toHaveText(`Downloaded ${file.suggestedFilename()}`);
    expect(file.suggestedFilename()).toMatch(/^ps-dashboard-state-gen9ou-test-123-.+\.json$/);
    const state = JSON.parse(readFileSync(await file.path(), 'utf-8')) as Captured;
    expect(state.kind).toBe('ps-dashboard-state');
    expect(state.app.version).toBe(packageVersion);
    expect(state.app.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(state.replay.id).toBe('gen9ou-test-123');
    expect(state.variation.history.length).toBeGreaterThan(0);
    expect(state.builtSets?.p1Team.length).toBeGreaterThan(0);
    expect(JSON.stringify(state)).not.toContain('serializedPosition');
  });

  test('a captured state restores on a fresh page: the same variation, pointer, drafts and sets', async ({ page }) => {
    test.setTimeout(180_000);
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1, { p1Move: 'Swords Dance' });
    const p1 = page.locator('.ps-branch-side-column').first();
    const p2 = page.locator('.ps-branch-side-column').nth(1);
    await p1.locator('.ps-movebtn:enabled').first().click();
    await p2.locator('.ps-movebtn:enabled').first().click();
    await page.locator('.ps-execute-btn').click();
    const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
    await expect(history).toContainText('Turn 2', { timeout: 60_000 });
    // One turn back and a draft pick there: a non-tip view with a pending choice.
    await page.locator('.ps-branch-bar button', { hasText: '◀' }).click();
    await expect(page.getByText('T2/')).toBeVisible();
    await p1.locator('.ps-movebtn:enabled').nth(1).click();
    const saved = await capture(page);
    expect(saved.choices.draft.p1.length).toBe(1);

    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
    await page.evaluate(state => (window as unknown as { __psState: StateHandle }).__psState.restore(state), saved);
    await expect(history).toContainText('Turn 2', { timeout: 60_000 });
    await expect(page.getByText('T2/')).toBeVisible();

    const restored = await capture(page);
    expect(restored.variation).toEqual(saved.variation);
    expect(restored.view).toEqual(saved.view);
    expect(restored.choices.draft).toEqual(saved.choices.draft);
    expect(restored.builtSets).toEqual(saved.builtSets);
  });
});
