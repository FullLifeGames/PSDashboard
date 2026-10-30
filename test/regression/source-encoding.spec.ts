import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Round 79: a Windows tool rewrote `packages/eval-engine/src/denied-end.ts` in the ANSI code page, so one em dash of a
 * comment became the byte 0x97. `tsc -b`, the lint and the test suites read the file without a word; the production build
 * refused it ("UNLOADABLE_DEPENDENCY ... stream did not contain valid UTF-8"). Every source file the build, the tests and
 * the scripts read is UTF-8.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const FOLDERS = ['src', 'packages/eval-engine/src', 'packages/replay-core/src', 'packages/eval-engine/test', 'packages/replay-core/test', 'test', 'scripts'];
const SOURCE = /\.(ts|tsx|mts|mjs|cjs|js|css|html|json|md)$/;
const SKIP = new Set(['node_modules', 'dist', 'fixtures', 'test-results']);

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (SOURCE.test(name)) yield path;
  }
}

describe('source encoding', () => {
  test('every source file decodes as UTF-8', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const invalid: string[] = [];
    let read = 0;
    for (const folder of FOLDERS) {
      for (const path of sources(join(root, folder))) {
        read++;
        try {
          decoder.decode(readFileSync(path));
        } catch {
          invalid.push(relative(root, path).replace(/\\/g, '/'));
        }
      }
    }
    expect(read).toBeGreaterThan(500);
    expect(invalid).toEqual([]);
  });
});
