import { expect, type Browser, type Page } from '@playwright/test';
import { routeOfflineFixtures } from './helpers';
import { lightEngine } from './dock-helpers';

/**
 * Round 89 (lane H, #105): the helpers the new-game specs share (the share link, the slider's state, a second browser context).
 */

/** Light engine settings and the offline replay fixtures; call it before `page.goto`. */
export async function prepare(page: Page): Promise<void> {
  await lightEngine(page);
  await routeOfflineFixtures(page);
}

/** The link the Copy Share Link button writes into its field. */
export async function copiedLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Copy Share Link' }).click();
  const field = page.getByLabel('Branch share link');
  await expect(field).toHaveValue(/#branch=/);
  return field.inputValue();
}

/** The slider's value and end: the position of the pointer and the length of the line the slider spans. */
export const timelineState = (page: Page) => page.locator('.ps-branch-bar input[type="range"]').evaluate(input => {
  const range = input as HTMLInputElement;
  return { value: range.value, max: range.max };
});

/** A fresh browser context (no storage of the sharer) that opens the link. */
export async function openInFreshContext(browser: Browser, link: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await prepare(page);
  await page.goto(link);
  return { page, close: () => context.close() };
}
