// Records Smogon data files as feedback-harness fixtures:
//   node scripts/record-smogon-fixtures.mjs /sets/gen8ou.json /sets/gen8ubers.json ...
// Fetches each path through the data hosts (data.pkmn.cc, then the GitHub
// Pages mirror), writes e2e-feedback/fixtures/smogon/<pathKey>.json, or a
// <pathKey>.404 marker when the file is absent on both hosts. Same key
// rule as e2e-feedback/hermetic.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOSTS = ['https://data.pkmn.cc', 'https://pkmn.github.io/smogon/data'];
const DIR = join('e2e-feedback', 'fixtures', 'smogon');
const pathKey = path => path.replace(/\/{2,}/g, '/').replace(/[^a-z0-9.]+/gi, '_');

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node scripts/record-smogon-fixtures.mjs /sets/gen8ou.json ...');
  process.exit(1);
}
for (const path of paths) {
  // Git Bash rewrites "/sets/x.json" into a Windows path; refuse to pin under a mangled key.
  if (!path.startsWith('/')) {
    console.error(`not a data path: ${path} (run with MSYS_NO_PATHCONV=1 under Git Bash)`);
    process.exit(1);
  }
}
mkdirSync(DIR, { recursive: true });
for (const path of paths) {
  let body = null;
  let status = 0;
  for (const host of HOSTS) {
    try {
      const response = await fetch(`${host}${path}`);
      status = response.status;
      if (response.ok) { body = await response.text(); break; }
      if (response.status === 404) break;
    } catch (error) {
      console.log(`${host}${path}: ${error.message}`);
    }
  }
  const key = pathKey(path);
  if (body !== null) {
    JSON.parse(body); // refuse to pin a non-JSON body
    writeFileSync(join(DIR, `${key}.json`), body);
    console.log(`pinned ${key}.json (${body.length} bytes)`);
  } else {
    writeFileSync(join(DIR, `${key}.404`), '');
    console.log(`pinned ${key}.404 (status ${status})`);
  }
}
