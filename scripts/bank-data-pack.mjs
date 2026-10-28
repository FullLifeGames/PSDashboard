// Packs, uploads and fetches the bank's data for CI (round 71, bank in GitHub Actions).
//
//   node scripts/bank-data-pack.mjs                 pack .fit-corpus and .smogon-cache into
//                                                   .calibration/bank-data/<asset> and write
//                                                   test/regression/fixtures/bank-data.json (asset, hashes, folders)
//   node scripts/bank-data-pack.mjs --upload        upload the packed asset as the GitHub release the fixture
//                                                   names (gh CLI); only after the user's okay, never by a script
//   node scripts/bank-data-pack.mjs --fetch [--file <path>]
//                                                   in CI: take the asset from <path> or download it from the
//                                                   release, check its sha256, unpack it into the checkout and
//                                                   check that both folders hash as the fixture says
//
// The tarball holds what a CI run reads from disk: every file of .smogon-cache and, of .fit-corpus, every replay the
// fit source reads (round 74, T163: CI captures the fit corpus with search): the manifest's replays
// (test/regression/fixtures/fit-corpus-manifest.json, FIT_MANIFEST in test/regression/bank-universe.ts) and the holdout sets'
// replays (test/regression/fixtures/fit-holdout-manifest.json, read by the holdout source there). The sample caches of
// the weight fits (samples-cache*.json) stay here, and so does what no manifest names; the bank fetches its own
// replays from the network, here as in CI.
// The fixture is tracked, so a commit names exactly the data its CI runs read (scripts/bank-data.mjs).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, CACHE_DIRS, hashDirectory } from './calibration-fingerprint.mjs';
import { downloadWithRetry, packData, unpackData } from './bank-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = 'test/regression/fixtures/bank-data.json';
/** The holdout sets test/regression/bank-universe.ts reads (HOLDOUT_MANIFEST there). */
const HOLDOUT_MANIFEST = 'test/regression/fixtures/fit-holdout-manifest.json';
/** The fit corpus test/regression/bank-universe.ts reads for EVAL_CALIBRATION_SOURCE=fit (FIT_MANIFEST there). */
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

/**
 * The files to pack: all of .smogon-cache, and of .fit-corpus every replay the fit source reads, the manifest's and
 * the holdout's. A holdout replay must be there; a manifest replay the cache lacks is skipped by a run on the fit
 * source too (round 74: five of 5,627 on the build machine), so the pack reports them and goes on.
 */
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
  // A pre-release that is never "Latest": the site's Pages build lists releases and serves the newest one with a build
  // zip; this one carries none, and the repository's latest release stays the app's. Its tag points at v1: a release
  // event runs pages.yml from the tagged commit, and v1's pages.yml skips bank data releases (master's may not yet).
  execFileSync('gh', [
    'release', 'create', fixture.release, assetPath, '--prerelease', '--latest=false', '--target', 'v1',
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
