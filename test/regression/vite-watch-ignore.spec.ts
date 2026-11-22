import { describe, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from '../../vite.config';

/**
 * Round 90 (#222, step E1): the dev server watches the repository root, and on devbox the local folders (`docs/`
 * with 33,000 files, `.calibration/` with 23,000) used up the inotify budget: 37,260 `ENOSPC` lines in one e2e run.
 * The folders below hold no module the app imports; the watch skips them. Tracked root files (README.md, index.html,
 * the configs) stay watched, so an edit there still reloads the page.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const UNWATCHED = ['.calibration', '.claude', '.fit-corpus', '.playwright-mcp', '.smogon-cache', 'docs'];
const WATCHED = ['src', 'packages', 'public', 'test', 'scripts', 'index.html', 'package.json', 'README.md'];

const ignored = (config as { server?: { watch?: { ignored?: unknown } } }).server?.watch?.ignored;

describe('vite.config.ts server.watch.ignored', () => {
  test('is a list of strings', () => {
    expect(Array.isArray(ignored)).toBe(true);
    expect((ignored as unknown[]).every(entry => typeof entry === 'string')).toBe(true);
  });

  test('skips exactly the local folders of the repository root', () => {
    expect([...(ignored as string[])].sort()).toEqual(UNWATCHED.map(folder => `${ROOT}/${folder}/**`));
  });

  test.each(WATCHED)('keeps %s watched and present at the root', name => {
    expect(existsSync(`${ROOT}/${name}`)).toBe(true);
    expect((ignored as string[]).some(glob => glob.startsWith(`${ROOT}/${name}/`) || glob === `${ROOT}/${name}`)).toBe(false);
  });
});
