import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every source file the build, the tests and the scripts read is UTF-8: an ANSI-written em dash (byte 0x97) passes `tsc -b` and lint, and only the production build refuses it. */
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
