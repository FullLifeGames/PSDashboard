import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures');
const SMOGON_DIR = join(FIXTURES, 'smogon');

/** Record mode: unpinned data.pkmn.cc responses are fetched live and saved. */
export const RECORD = process.env.FEEDBACK_RECORD === '1';

export interface HermeticLog {
  /** Non-cosmetic external requests that were neither pinned nor recordable. */
  violations: string[];
  /** data.pkmn.cc requests with no pin outside record mode. */
  smogonMisses: string[];
}

const pathKey = (url: URL) => url.pathname.replace(/[^a-z0-9.]+/gi, '_');

/**
 * Pins every input: the replay JSON from its fixture, data.pkmn.cc from
 * recordings (404s recorded too — absence is an input), the replay-embed
 * script as an inert stub, play.pokemonshowdown.com assets (sprites/audio)
 * silently dropped as cosmetic. Everything else external is a violation.
 * Playwright routes: the LAST registered route wins — catch-all first.
 */
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
  await page.route('https://data.pkmn.cc/**', async route => {
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
      // Upstream absence is an input too — record it so replays stay faithful.
      writeFileSync(missMarker, '');
      return route.fulfill({ status: 404, body: '' });
    }
    log.smogonMisses.push(url.href);
    return route.fulfill({ status: 404, body: '' });
  });
  return log;
}
