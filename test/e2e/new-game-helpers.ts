import { expect, type Browser, type Page } from '@playwright/test';
import { routeOfflineFixtures } from './helpers';
import { lightEngine } from './dock-helpers';

/** Light engine settings and the offline replay fixtures; call it before `page.goto`. */
export async function prepare(page: Page): Promise<void> {
  await lightEngine(page);
  await routeOfflineFixtures(page);
}

export async function copiedLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Copy Share Link' }).click();
  const field = page.getByLabel('Branch share link');
  await expect(field).toHaveValue(/#branch=/);
  return field.inputValue();
}

export const timelineState = (page: Page) => page.locator('.ps-branch-bar input[type="range"]').evaluate(input => {
  const range = input as HTMLInputElement;
  return { value: range.value, max: range.max };
});

export async function openInFreshContext(browser: Browser, link: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await prepare(page);
  await page.goto(link);
  return { page, close: () => context.close() };
}

export async function copiedGameLink(page: Page): Promise<{ link: string; payload: { kind: string; gameId: string; entries: unknown[]; variation?: { startTurn: number }; view?: { turn: number; line: string; t0?: boolean } } }> {
  await page.locator('.ps-loader-toggle').click();
  await page.locator('.ps-loader-panel').getByRole('button', { name: 'Copy Share Link' }).click();
  const field = page.getByLabel('Game share link');
  await expect(field).toHaveValue(/#branch=/);
  const link = await field.inputValue();
  await page.keyboard.press('Escape');
  return { link, payload: JSON.parse(Buffer.from(link.split('#branch=')[1], 'base64url').toString('utf8')) };
}
