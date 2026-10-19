import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearPairs, newTwins, placesOf, twinsOf } from '../scripts/twin-lists.mjs';

/**
 * Round 72 (T236): the twin detector. AGENTS.md says one rule lives in one module and a deliberate copy gets a spec that compares
 * the two. scripts/twin-lists.mjs finds a list of 3 or more string literals that stands in two or more files with the same
 * names (the stat names in four files, Reflect / Light Screen / Aurora Veil in five), and `npm run lint` fails on a pair
 * (list, file) that scripts/twin-baseline.json lacks. The baseline only shrinks.
 *
 * The cases run on a temporary tree. The detector reads names, not formats: a list for singles and a list for doubles are the same
 * kind of thing to it. Its limit: a copy with one more element is no twin (the report-only --near sees it).
 */

const SCRIPT = fileURLToPath(new URL('../scripts/twin-lists.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const made: string[] = [];

/** A tree with packages/a/src, packages/b/src and src, from `{ "<path>": "<text>" }`. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'twin-lists-'));
  made.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

const LIST = "export const SCREENS = ['Reflect', 'Light Screen', 'Aurora Veil'];\n";
const KEY = 'auroraveil,lightscreen,reflect';
const A = 'packages/a/src/x.ts';
const B = 'packages/b/src/y.ts';

describe('twinsOf and newTwins', () => {
  test('an identical list in two files is a group; the key is the sorted unique ids', () => {
    const root = tree({ [A]: LIST, [B]: "export const OTHER = new Set(['aurora-veil', 'Reflect', 'light screen', 'reflect']);\n" });
    expect(twinsOf(root)).toEqual({ [KEY]: [A, B] });
  });

  test('a new identical list in a second file fails, naming both places', () => {
    const root = tree({ [A]: LIST, [B]: LIST });
    const found = newTwins(root, { groups: {} });
    expect(found).toHaveLength(2);
    expect(found.join('\n')).toContain(`${A}:1`);
    expect(found.join('\n')).toContain(`${B}:1`);
  });

  test('the same group in the baseline passes; a third file does not', () => {
    const baseline = { groups: { [KEY]: [A, B] } };
    expect(newTwins(tree({ [A]: LIST, [B]: LIST }), baseline)).toEqual([]);
    const three = newTwins(tree({ [A]: LIST, [B]: LIST, 'src/z.ts': LIST }), baseline);
    expect(three).toHaveLength(1);
    expect(three[0]).toContain('src/z.ts');
  });

  test('a group that lost a file passes, and a group down to one file is no twin', () => {
    const baseline = { groups: { [KEY]: [A, B, 'src/z.ts'] } };
    expect(newTwins(tree({ [A]: LIST, [B]: LIST }), baseline)).toEqual([]);
    expect(twinsOf(tree({ [A]: LIST }))).toEqual({});
  });

  test('a file moved into a group while another left it fails', () => {
    const baseline = { groups: { [KEY]: [A, B] } };
    expect(newTwins(tree({ [A]: LIST, 'src/z.ts': LIST }), baseline)).toHaveLength(1);
  });

  test('a two-element list, a list with a non-string, a call and a type union are no lists', () => {
    const text = [
      "export const PAIR = ['Reflect', 'Light Screen'];",
      "export const MIXED = ['Reflect', 'Light Screen', 'Aurora Veil', 1];",
      "export const CALL = f('Reflect', 'Light Screen', 'Aurora Veil');",
      "export type Screen = 'Reflect' | 'Light Screen' | 'Aurora Veil';",
      '',
    ].join('\n');
    expect(twinsOf(tree({ [A]: text, [B]: text }))).toEqual({});
  });

  test('two lists in one file, a list in a test and a list outside the source folders are no twins', () => {
    expect(twinsOf(tree({ [A]: LIST + LIST.replace('SCREENS', 'MORE') }))).toEqual({});
    expect(twinsOf(tree({ [A]: LIST, 'packages/a/test/x.spec.ts': LIST, 'regression/x.spec.ts': LIST }))).toEqual({});
  });

  test('src and the package sources are both read', () => {
    expect(twinsOf(tree({ [A]: LIST, 'src/lib/z.ts': LIST }))).toEqual({ [KEY]: [A, 'src/lib/z.ts'] });
  });

  test('twin-ok with the path of an existing spec exempts the list; a missing path does not', () => {
    const ok = tree({ [A]: LIST, [B]: `// twin-ok: regression/compare.spec.ts\n${LIST}`, 'regression/compare.spec.ts': '// compares the lists\n' });
    expect(twinsOf(ok)).toEqual({});
    const missing = tree({ [A]: LIST, [B]: `// twin-ok: regression/missing.spec.ts\n${LIST}` });
    expect(twinsOf(missing)).toEqual({ [KEY]: [A, B] });
    const bare = tree({ [A]: LIST, [B]: `// twin-ok\n${LIST}` });
    expect(twinsOf(bare)).toEqual({ [KEY]: [A, B] });
  });
});

describe('the cheap test before the parser', () => {
  test('lists in every written form still reach the parser', () => {
    const forms = [
      "export const A = [\n  // the screens\n  'Reflect',\n  'Light Screen',\n  'Aurora Veil', // last\n];\n",
      "export const A = [/* x */ 'Reflect', 'Light Screen', 'Aurora Veil'];\n",
      "export const A = new Set<string>([\"Reflect\", `Light Screen`, 'Aurora Veil']);\n",
      "export const A = { screens: ['Reflect', 'Light Screen', 'Aurora Veil'] as const };\n",
      "export const A = ['Reflect',\n 'Light Screen',\n 'Aurora Veil'] as const;\n",
    ];
    for (const form of forms) expect(twinsOf(tree({ [A]: form, [B]: LIST })), form).toEqual({ [KEY]: [A, B] });
  });

  test('on the real tree the parser sees no list the cheap test dropped', () => {
    const keys = (prefilter: boolean) => [...placesOf(REPO, undefined, { prefilter }).keys()].sort();
    expect(keys(true)).toEqual(keys(false));
  });
});

describe('nearPairs', () => {
  test('a copy with one more element is reported near and never fails', () => {
    const longer = "export const SCREENS = ['Reflect', 'Light Screen', 'Aurora Veil', 'Safeguard', 'Mist'];\n";
    const shorter = "export const SCREENS = ['Reflect', 'Light Screen', 'Aurora Veil', 'Safeguard'];\n";
    const root = tree({ [A]: longer, [B]: shorter });
    expect(twinsOf(root)).toEqual({});
    expect(nearPairs(root)).toHaveLength(1);
    expect(nearPairs(root)[0]).toMatchObject({ jaccard: 0.8 });
  });

  test('two lists with little in common are no near pair', () => {
    const other = "export const X = ['Tackle', 'Pound', 'Scratch', 'Growl'];\n";
    expect(nearPairs(tree({ [A]: LIST, [B]: other }))).toEqual([]);
  });
});

describe('the command', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  test('a new twin makes it exit 1 and print both places; the baseline makes it exit 0', () => {
    const root = tree({ [A]: LIST, [B]: LIST, 'twin-baseline.json': '{"groups":{}}' });
    const failing = run('--root', root, '--baseline', path.join(root, 'twin-baseline.json'));
    expect(failing.status).toBe(1);
    expect(failing.stderr + failing.stdout).toContain(`${B}:1`);
    writeFileSync(path.join(root, 'twin-baseline.json'), JSON.stringify({ groups: { [KEY]: [A, B] } }));
    expect(run('--root', root, '--baseline', path.join(root, 'twin-baseline.json')).status).toBe(0);
  });

  test('on the real tree it exits 0 and finds the groups the baseline holds', () => {
    const baseline = JSON.parse(readFileSync(path.join(REPO, 'scripts', 'twin-baseline.json'), 'utf8')) as { groups: Record<string, string[]> };
    const result = run('--json');
    expect(result.status).toBe(0);
    const found = JSON.parse(result.stdout) as { groups: Record<string, string[]> };
    expect(Object.keys(found.groups).sort()).toEqual(Object.keys(baseline.groups).sort());
    expect(Object.keys(found.groups).length).toBeGreaterThanOrEqual(8);
  });
});

describe('scripts/update-name-baseline.mjs, the twin half', () => {
  test('diffTwins names the pairs that came and the pairs that left; the shipped baseline equals the tree', async () => {
    const { diffTwins } = await import('../scripts/update-name-baseline.mjs');
    const diff = diffTwins({ 'a,b,c': ['x.ts', 'y.ts', 'z.ts'] }, { 'a,b,c': ['x.ts', 'w.ts'] });
    expect(diff.added).toEqual(['a,b,c: w.ts']);
    expect(diff.removed).toEqual(['a,b,c: y.ts', 'a,b,c: z.ts']);
    const shipped = JSON.parse(readFileSync(path.join(REPO, 'scripts', 'twin-baseline.json'), 'utf8')) as { groups: Record<string, string[]> };
    expect(diffTwins(shipped.groups, twinsOf(REPO)).added).toEqual([]);
  });
});
