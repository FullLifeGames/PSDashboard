// Packs, uploads and fetches the bank's data for CI.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, CACHE_DIRS, hashDirectory } from './calibration-fingerprint.mjs';
import { downloadWithRetry, packData, unpackData } from './bank-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = 'test/regression/fixtures/bank-data.json';
// Both manifests are the ones test/regression/bank-universe.ts reads (HOLDOUT_MANIFEST and FIT_MANIFEST there).
const HOLDOUT_MANIFEST = 'test/regression/fixtures/fit-holdout-manifest.json';
const FIT_MANIFEST = 'test/regression/fixtures/fit-corpus-manifest.json';
const PACK_DIR = '.calibration/bank-data';
const FORMAT = 1;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { mode: 'pack', file: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--upload') options.mode = 'upload';
    else if (arg === '--fetch') options.mode = 'fetch';
    else if (arg === '--file') {
      options.file = argv[++index];
      if (!options.file) fail('--file needs a path');
    } else fail(`unknown argument ${arg}`);
  }
  return options;
}

const readFixture = () => {
  const path = join(ROOT, FIXTURE);
  if (!existsSync(path)) fail(`${FIXTURE} is missing; pack the data first`);
  return JSON.parse(readFileSync(path, 'utf8'));
};
const sha256 = data => createHash('sha256').update(data).digest('hex');
const megabytes = bytes => `${(bytes / 1e6).toFixed(1)} MB`;

// A manifest replay the cache lacks is skipped (a fit-source run skips it too); a holdout replay must be there.
function selection() {
  const holdout = [...new Set(JSON.parse(readFileSync(join(ROOT, HOLDOUT_MANIFEST), 'utf8')).sets.flatMap(set => set.ids))];
  const missing = holdout.filter(id => !existsSync(join(ROOT, '.fit-corpus', `${id}.json`)));
  if (missing.length > 0) fail(`${missing.length} holdout replay(s) missing from .fit-corpus (first: ${missing[0]}); run scripts/build-fit-corpus.mjs first`);
  const manifest = JSON.parse(readFileSync(join(ROOT, FIT_MANIFEST), 'utf8')).replays.map(entry => entry.id);
  const ids = [...new Set([...manifest, ...holdout])];
  const absent = ids.filter(id => !existsSync(join(ROOT, '.fit-corpus', `${id}.json`)));
  if (absent.length > 0) console.log(`${absent.length} manifest replay(s) not in .fit-corpus, left out (first: ${absent[0]})`);
  const skipped = new Set(absent);
  return { '.smogon-cache': null, '.fit-corpus': ids.filter(id => !skipped.has(id)).map(id => `${id}.json`) };
}

function pack() {
  const result = packData(ROOT, selection());
  const tag = `bank-data-${result.tarSha256.slice(0, 16)}`;
  const asset = `${tag}.tar.gz`;
  const assetPath = join(ROOT, PACK_DIR, asset);
  mkdirSync(dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, result.gz);
  const fixture = {
    format: FORMAT, release: tag, asset, sha256: result.sha256, bytes: result.gz.length, tarSha256: result.tarSha256,
    files: result.files, dirs: result.dirs,
  };
  mkdirSync(dirname(join(ROOT, FIXTURE)), { recursive: true });
  writeFileSync(join(ROOT, FIXTURE), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`packed ${result.files} files (${CACHE_DIRS.map(dir => `${dir} ${result.dirs[dir]?.files ?? 0}`).join(', ')}) into ${relative(ROOT, assetPath)}, ${megabytes(result.gz.length)}`);
  console.log(`sha256 ${result.sha256}, tar ${result.tarSha256}`);
  console.log(`wrote ${FIXTURE}; upload after the user's okay: node scripts/bank-data-pack.mjs --upload`);
}

function upload() {
  const fixture = readFixture();
  const assetPath = join(ROOT, PACK_DIR, fixture.asset);
  if (!existsSync(assetPath)) fail(`${relative(ROOT, assetPath)} is missing; pack the data first`);
  const data = readFileSync(assetPath);
  if (sha256(data) !== fixture.sha256) fail(`${relative(ROOT, assetPath)} does not match ${FIXTURE}; pack again`);
  let exists = true;
  try {
    execFileSync('gh', ['release', 'view', fixture.release], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    exists = false;
  }
  if (exists) fail(`the release ${fixture.release} exists already; nothing uploaded`);
  // A pre-release, never "Latest": Pages serves the newest release that carries a build zip, and this one carries none.
  // Its tag points at master: the release event runs pages.yml from that commit, which skips bank data releases.
  execFileSync('gh', [
    'release', 'create', fixture.release, assetPath, '--prerelease', '--latest=false', '--target', 'master',
    '--title', `Bank data ${fixture.release.slice('bank-data-'.length)}`,
    '--notes', `Replays and Smogon data the calibration bank reads in CI (${fixture.files} files). sha256 ${fixture.sha256}.`,
  ], { cwd: ROOT, stdio: 'inherit' });
  console.log(`uploaded ${fixture.asset} as release ${fixture.release}`);
}

async function fetchAsset(fixture) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) fail('--fetch without --file needs GITHUB_REPOSITORY (owner/name)');
  const url = `https://github.com/${repository}/releases/download/${fixture.release}/${fixture.asset}`;
  try {
    return await downloadWithRetry(url);
  } catch (error) {
    fail(error.message);
  }
}

async function fetchData(options) {
  const fixture = readFixture();
  if (fixture.format !== FORMAT) fail(`${FIXTURE} has format ${fixture.format}, this script reads ${FORMAT}`);
  const file = options.file ? resolve(ROOT, options.file) : null;
  const data = file && existsSync(file) ? readFileSync(file) : await fetchAsset(fixture);
  if (sha256(data) !== fixture.sha256) fail(`the asset's sha256 ${sha256(data)} is not the ${fixture.sha256} that ${FIXTURE} names; nothing unpacked`);
  if (file && !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  const { files } = unpackData(data, ROOT);
  const mismatched = CACHE_DIRS.filter(dir => canonicalJson(hashDirectory(join(ROOT, dir))) !== canonicalJson(fixture.dirs[dir]));
  if (mismatched.length > 0) fail(`after unpacking, ${mismatched.join(' and ')} do not hash as ${FIXTURE} says`);
  console.log(`unpacked ${files} files; ${CACHE_DIRS.join(' and ')} hash as ${FIXTURE} says`);
}

const options = parseArgs(process.argv.slice(2));
if (options.mode === 'pack') pack();
else if (options.mode === 'upload') upload();
else await fetchData(options);
