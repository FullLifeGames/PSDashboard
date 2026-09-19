// Records Smogon data files as feedback-harness fixtures:
//   node scripts/record-smogon-fixtures.mjs /sets/gen8ou.json /sets/gen8ubers.json ...
//   node scripts/record-smogon-fixtures.mjs --from-cache .smogon-cache /stats/gen9doublesou.json ...
// Fetches each path through the data hosts (data.pkmn.cc, then the GitHub
// Pages mirror), writes e2e-feedback/fixtures/smogon/<pathKey>.json, or a
// <pathKey>.404 marker when the file is absent on both hosts. Same key
// rule as e2e-feedback/hermetic.ts.
// --from-cache reads the calibration bank's disk cache instead of the network
// (regression/smogon-fetch-cache.ts: one {status, payload} entry per URL), so
// a replay the bank already measures gets the very inputs the bank measured
// it with. It never replaces a pin that exists, and it refuses a cached
// network failure: only a 200 or a 404 is an input.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOSTS = ['https://data.pkmn.cc', 'https://pkmn.github.io/smogon/data'];
const DIR = join('e2e-feedback', 'fixtures', 'smogon');
const pathKey = path => path.replace(/\/{2,}/g, '/').replace(/[^a-z0-9.]+/gi, '_');
/** The file name diskCachedSmogonFetcher gives a URL. */
const cacheKey = url =>
  `${url.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.json`;

const args = process.argv.slice(2);
const cacheFlag = args.indexOf('--from-cache');
const cacheDir = cacheFlag >= 0 ? args[cacheFlag + 1] : null;
const paths = cacheFlag >= 0 ? [...args.slice(0, cacheFlag), ...args.slice(cacheFlag + 2)] : args;
if (paths.length === 0 || (cacheFlag >= 0 && !cacheDir)) {
  console.error('usage: node scripts/record-smogon-fixtures.mjs [--from-cache <dir>] /sets/gen8ou.json ...');
  process.exit(1);
}
for (const path of paths) {
  // Git Bash rewrites "/sets/x.json" into a Windows path; refuse to pin under a mangled key.
  if (!path.startsWith('/')) {
    console.error(`not a data path: ${path} (run with MSYS_NO_PATHCONV=1 under Git Bash)`);
    process.exit(1);
  }
}

async function fromNetwork(path) {
  let status = 0;
  for (const host of HOSTS) {
    try {
      const response = await fetch(`${host}${path}`);
      status = response.status;
      if (response.ok) return { body: await response.text(), status };
      if (response.status === 404) break;
    } catch (error) {
      console.log(`${host}${path}: ${error.message}`);
    }
  }
  return { body: null, status };
}

function fromCache(path) {
  const file = join(cacheDir, cacheKey(`${HOSTS[0]}${path}`));
  if (!existsSync(file)) throw new Error(`${path}: no cache entry at ${file}`);
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  if (entry.status === 404) return { body: null, status: 404 };
  if (entry.status !== 200 || entry.payload === undefined) throw new Error(`${path}: cached status ${entry.status} is no input`);
  return { body: JSON.stringify(entry.payload), status: 200 };
}

mkdirSync(DIR, { recursive: true });
for (const path of paths) {
  const key = pathKey(path);
  if (cacheDir && (existsSync(join(DIR, `${key}.json`)) || existsSync(join(DIR, `${key}.404`)))) {
    console.log(`kept ${key} (already pinned)`);
    continue;
  }
  const { body, status } = cacheDir ? fromCache(path) : await fromNetwork(path);
  if (body !== null) {
    JSON.parse(body); // refuse to pin a non-JSON body
    writeFileSync(join(DIR, `${key}.json`), body);
    console.log(`pinned ${key}.json (${body.length} bytes)`);
  } else {
    writeFileSync(join(DIR, `${key}.404`), '');
    console.log(`pinned ${key}.404 (status ${status})`);
  }
}
