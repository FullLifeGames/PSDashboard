import type { Page, Route } from '@playwright/test';

/** One handler for both Smogon data hosts: data.pkmn.cc and its GitHub Pages mirror. */
export async function routeSmogon(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route('https://data.pkmn.cc/**', handler);
  await page.route('https://pkmn.github.io/smogon/data/**', handler);
}

/** Empty Smogon payloads: deterministic teams, and the Smogon-loading guard settles. */
export const emptySmogon = (route: Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
