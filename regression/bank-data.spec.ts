import { afterAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDirectory } from '../scripts/calibration-fingerprint.mjs';
import { packData, tarEntry, tarEnd, unpackData } from '../scripts/bank-data.mjs';

/**
 * Round 71 (bank in GitHub Actions): the bank's data (.fit-corpus and .smogon-cache) travels to CI as one gzipped
 * tar. Packing the same folders twice gives the same bytes; the CI job checks the file's sha256, unpacks only
 * regular files under the two folders and checks that the folders hash as the fingerprint read them here, so a CI
 * run's fingerprint names the same data as a local run's.
 */

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
const folder = (label: string) => {
  const dir = mkdtempSync(join(tmpdir(), `bank-data-${label}-`));
  made.push(dir);
  return dir;
};
const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

function dataRoot(): string {
  const root = folder('source');
  put(root, '.fit-corpus/gen9ou-1.json', '{"id":"gen9ou-1","log":"|turn|1\\n"}\n');
  put(root, '.fit-corpus/gen9vgc2025regg-2.json', '{"id":"gen9vgc2025regg-2"}\n');
  put(root, '.smogon-cache/sets/gen9ou.json', '{"status":200,"body":"{}"}\n');
  put(root, '.smogon-cache/stats/gen9ou.json', '{"status":200,"body":"[]"}\n');
  put(root, '.smogon-cache/stats/half.json.tmp', 'half written');
  return root;
}

/** A gzipped tar with one entry, built from the same header writer the pack uses. */
const archiveWith = (name: string, options: { type?: string; linkName?: string } = {}) =>
  gzipSync(Buffer.concat([tarEntry(name, Buffer.from('payload\n'), options), tarEnd()]));

describe('the bank data travels as one gzipped tar', () => {
  test('two packs of the same folders give the same bytes and the hashes the fingerprint reads', () => {
    const root = dataRoot();
    const first = packData(root);
    const second = packData(root);
    expect(first.gz.equals(second.gz)).toBe(true);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tarSha256).toBe(second.tarSha256);
    expect(first.dirs).toEqual({
      '.fit-corpus': hashDirectory(join(root, '.fit-corpus')),
      '.smogon-cache': hashDirectory(join(root, '.smogon-cache')),
    });
    expect(first.files).toBe(4);
  });

  test('a selection packs only the chosen files and records the hash a folder of exactly these files has', () => {
    const root = dataRoot();
    const pack = packData(root, { '.smogon-cache': null, '.fit-corpus': ['gen9ou-1.json'] });
    expect(pack.files).toBe(3);
    const target = folder('subset');
    expect(unpackData(pack.gz, target)).toEqual({ files: 3 });
    expect(existsSync(join(target, '.fit-corpus', 'gen9vgc2025regg-2.json'))).toBe(false);
    expect(hashDirectory(join(target, '.fit-corpus'))).toEqual(pack.dirs['.fit-corpus']);
    expect(pack.dirs['.fit-corpus']).not.toEqual(hashDirectory(join(root, '.fit-corpus')));
    expect(pack.dirs['.smogon-cache']).toEqual(hashDirectory(join(root, '.smogon-cache')));
  });

  test('unpacking restores every file, the folders hash as before, and a half-written .tmp file stays out', () => {
    const root = dataRoot();
    const pack = packData(root);
    const target = folder('target');
    const unpacked = unpackData(pack.gz, target);
    expect(unpacked).toEqual({ files: 4 });
    expect(hashDirectory(join(target, '.fit-corpus'))).toEqual(pack.dirs['.fit-corpus']);
    expect(hashDirectory(join(target, '.smogon-cache'))).toEqual(pack.dirs['.smogon-cache']);
    expect(readFileSync(join(target, '.smogon-cache', 'sets', 'gen9ou.json'), 'utf8')).toBe('{"status":200,"body":"{}"}\n');
    expect(existsSync(join(target, '.smogon-cache', 'stats', 'half.json.tmp'))).toBe(false);
  });

  test.each([
    ['a file outside the two folders', 'src/evil.ts'],
    ['a parent step', '.fit-corpus/../package.json'],
    ['an absolute path', '/etc/passwd'],
    ['a drive path', 'C:/Windows/evil.json'],
    ['a backslash path', '.fit-corpus\\..\\evil.json'],
  ])('unpacking refuses %s and writes nothing', (_label, name) => {
    const target = folder('refuse');
    expect(() => unpackData(archiveWith(name), target)).toThrow(/refuses/);
    expect(existsSync(join(target, '.fit-corpus'))).toBe(false);
    expect(existsSync(join(target, 'src'))).toBe(false);
  });

  test('unpacking refuses a link and a folder entry', () => {
    const target = folder('links');
    expect(() => unpackData(archiveWith('.fit-corpus/link.json', { type: '2', linkName: '/etc/passwd' }), target)).toThrow(/refuses/);
    expect(() => unpackData(archiveWith('.fit-corpus/sub/', { type: '5' }), target)).toThrow(/refuses/);
  });

  test('unpacking refuses a damaged header', () => {
    const tar = Buffer.concat([tarEntry('.fit-corpus/a.json', Buffer.from('x')), tarEnd()]);
    tar[0] ^= 1;
    expect(() => unpackData(gzipSync(tar), folder('damaged'))).toThrow(/checksum/);
  });
});

describe('bank-data-pack.mjs packs here and fetches in CI', () => {
  const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
  const withScripts = (root: string) => {
    for (const name of ['bank-data-pack.mjs', 'bank-data.mjs', 'calibration-fingerprint.mjs']) {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      copyFileSync(join(SCRIPTS, name), join(root, 'scripts', name));
    }
    return root;
  };
  /** The holdout sets of the temp checkout: the tarball takes these replays of .fit-corpus. */
  const holdout = (root: string, ids: string[]) =>
    put(root, 'regression/fixtures/fit-holdout-manifest.json', JSON.stringify({ sets: [{ key: 'doublesou|a|b', family: 'doublesou', ids }] }));
  const run = (root: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(root, 'scripts', 'bank-data-pack.mjs'), ...args], { cwd: root, encoding: 'utf8' });

  test('the pack writes the asset and the fixture; a checkout without data fetches it from the file and checks both folders', () => {
    const source = withScripts(dataRoot());
    holdout(source, ['gen9ou-1']);
    const packed = run(source);
    expect(packed.status, packed.stderr).toBe(0);
    const fixture = JSON.parse(readFileSync(join(source, 'regression', 'fixtures', 'bank-data.json'), 'utf8'));
    expect(fixture).toMatchObject({ format: 1, files: 3, release: expect.stringMatching(/^bank-data-[0-9a-f]{16}$/) });
    expect(fixture.asset).toBe(`${fixture.release}.tar.gz`);
    const asset = join(source, '.calibration', 'bank-data', fixture.asset);

    const ci = withScripts(folder('ci'));
    put(ci, 'regression/fixtures/bank-data.json', JSON.stringify(fixture));
    const fetched = run(ci, '--fetch', '--file', asset);
    expect(fetched.status, fetched.stderr).toBe(0);
    expect(hashDirectory(join(ci, '.fit-corpus'))).toEqual(fixture.dirs['.fit-corpus']);
    expect(hashDirectory(join(ci, '.smogon-cache'))).toEqual(fixture.dirs['.smogon-cache']);
    // CI fits no weights: the replays outside the holdout stay here.
    expect(existsSync(join(ci, '.fit-corpus', 'gen9vgc2025regg-2.json'))).toBe(false);
  });

  test('a holdout replay missing from .fit-corpus stops the pack', () => {
    const source = withScripts(dataRoot());
    holdout(source, ['gen9ou-1', 'gen9ou-404']);
    const packed = run(source);
    expect(packed.status).toBe(2);
    expect(packed.stderr).toMatch(/1 holdout replay\(s\) missing.*gen9ou-404/);
    expect(existsSync(join(source, 'regression', 'fixtures', 'bank-data.json'))).toBe(false);
  });

  test('a fetched file whose sha256 differs from the fixture unpacks nothing', () => {
    const source = withScripts(dataRoot());
    holdout(source, ['gen9ou-1']);
    expect(run(source).status).toBe(0);
    const fixture = JSON.parse(readFileSync(join(source, 'regression', 'fixtures', 'bank-data.json'), 'utf8'));
    const tampered = join(folder('tampered'), fixture.asset);
    const bytes = readFileSync(join(source, '.calibration', 'bank-data', fixture.asset));
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(tampered, bytes);
    const ci = withScripts(folder('ci'));
    put(ci, 'regression/fixtures/bank-data.json', JSON.stringify(fixture));
    const fetched = run(ci, '--fetch', '--file', tampered);
    expect(fetched.status).toBe(2);
    expect(fetched.stderr).toMatch(/sha256/);
    expect(existsSync(join(ci, '.fit-corpus'))).toBe(false);
  });
});
