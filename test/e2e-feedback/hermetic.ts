import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Page, Route } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures');
const SMOGON_DIR = join(FIXTURES, 'smogon');

export const RECORD = process.env.FEEDBACK_RECORD === '1';

export interface HermeticLog {
  violations: string[];
  smogonMisses: string[];
}

const SMOGON_HOSTS = ['https://data.pkmn.cc', 'https://pkmn.github.io/smogon/data'] as const;

const pathKey = (url: URL) => {
  const path = url.hostname === 'pkmn.github.io' ? url.pathname.replace(/^\/smogon\/data/, '') : url.pathname;
  return path.replace(/\/{2,}/g, '/').replace(/[^a-z0-9.]+/gi, '_');
};

// Playwright runs the LAST registered route first, so the catch-all goes first.
export async function installHermeticRoutes(page: Page, replayId: string): Promise<HermeticLog> {
  const log: HermeticLog = { violations: [], smogonMisses: [] };
  const replayFixture = readFileSync(join(FIXTURES, `${replayId}.json`), 'utf-8');

  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'play.pokemonshowdown.com') return route.abort();
    log.violations.push(url.href);
    return route.abort();
  });
  await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/replay.pokemonshowdown.com/**', route => {
    const url = route.request().url();
    if (!url.includes(replayId)) {
      log.violations.push(url);
      return route.abort();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: replayFixture });
  });
  const serveSmogon = async (route: Route) => {
    const url = new URL(route.request().url());
    const file = join(SMOGON_DIR, `${pathKey(url)}.json`);
    const missMarker = join(SMOGON_DIR, `${pathKey(url)}.404`);
    if (existsSync(file)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(file, 'utf-8') });
    }
    if (existsSync(missMarker)) return route.fulfill({ status: 404, body: '' });
    if (RECORD) {
      const response = await fetch(url.href);
      mkdirSync(SMOGON_DIR, { recursive: true });
      if (response.ok) {
        const body = await response.text();
        writeFileSync(file, body);
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      }
      writeFileSync(missMarker, '');
      return route.fulfill({ status: 404, body: '' });
    }
    log.smogonMisses.push(url.href);
    return route.fulfill({ status: 404, body: '' });
  };
  for (const host of SMOGON_HOSTS) await page.route(`${host}/**`, serveSmogon);
  return log;
}
