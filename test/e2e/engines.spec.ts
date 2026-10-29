import { test, expect } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, startVariationAt } from './helpers';

test.beforeAll(installReplayEmbedCache);

type Request = { protocol: string; options: { p1: { id: string; label: string }[]; p2: { id: string; label: string }[] }; state: string };

/** User gate 28.10.2026 (round 77, "1a 2a 3a 4a 5a 6a"): another engine plugs into the Evaluation panel. */
test('an engine added by address evaluates the position, and the dropdown and the panel name it', async ({ page }) => {
  test.setTimeout(180_000);
  await routeOfflineFixtures(page);
  const asked: Request[] = [];
  // The engine lives on the page's own origin here, so no CORS stands between: a real one allows the page's origin.
  await page.route('**/__test-engine/', async route => {
    const request = route.request().postDataJSON() as Request;
    asked.push(request);
    const values = (side: 'p1' | 'p2') => Object.fromEntries(request.options[side].map((option, index) => [option.id, index === 0 ? 0.5 : -0.5]));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ protocol: 'ps-dashboard-engine/1', score: 0.25, values: { p1: values('p1'), p2: values('p2') }, engine: { name: 'Test engine', version: '1.0' } }),
    });
  });
  await page.goto('/');
  await page.locator('button', { hasText: 'Load' }).click();
  await startVariationAt(page, 1);

  await expect(page.getByRole('combobox', { name: 'Engine' })).toHaveCount(0);
  await page.getByRole('button', { name: '+ engine' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Test engine');
  await page.getByRole('textbox', { name: 'Address' }).fill(new URL('/__test-engine/', page.url()).toString());
  await page.getByRole('button', { name: 'Add engine' }).click();
  await expect(page.getByRole('combobox', { name: 'Engine' })).toHaveValue(/__test-engine/);
  await expect(page.getByText('estimate from Test engine')).toBeVisible();

  await page.getByRole('button', { name: /^(Re-)?[Ee]valuate$/ }).click();
  // The first engine evaluation builds its request on the simulator in the main thread, which the unbundled dev server
  // serves module by module: under the full suite that took more than 30 seconds (round 77).
  await expect.poll(() => asked.length, { timeout: 90_000 }).toBeGreaterThan(0);
  expect(asked[0].protocol).toBe('ps-dashboard-engine/1');
  expect(asked[0].options.p1.length).toBeGreaterThan(0);
  expect(asked[0].state.length).toBeGreaterThan(1000);
  // The engine's favourite row (0.5 against -0.5 for every other) leads the panel's p1 ranking.
  const panel = page.locator('.ps-panel', { hasText: 'estimate from Test engine' });
  await expect(panel).toContainText(`1.${asked[0].options.p1[0].label}`);

  // Back to the own engine: the dropdown stays, the panel names the sim search again.
  await page.getByRole('combobox', { name: 'Engine' }).selectOption('ps-dashboard');
  await expect(page.getByText('estimate from a sim search, no oracle')).toBeVisible();
});
