import type { Page, Route } from '@playwright/test';

export async function routeSmogon(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route('https://data.pkmn.cc/**', handler);
  await page.route('https://pkmn.github.io/smogon/data/**', handler);
}

export const emptySmogon = (route: Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
