// Lists the rows of the Vitest suite without playing them, for `rows-compare.mjs`.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function rowsOfList(raw) {
  return raw.map(row => ({ name: row.name, file: row.file, projectName: row.projectName ?? '-' }));
}

// Static parsing finds no suite in a file that registers its rows through a helper, so the files are run to collect.
export function listArgs(rest) {
  return ['vitest', 'list', '--json', ...(rest.some(arg => arg.startsWith('--staticParse')) ? [] : ['--staticParse=false']), ...rest];
}

export function countPerProject(rows) {
  const counts = {};
  for (const row of rows) counts[row.projectName] = (counts[row.projectName] ?? 0) + 1;
  return counts;
}

function main(args) {
  const [outPath, ...rest] = args;
  if (!outPath) { console.error('usage: rows-collect.mjs <out.json> [--raw <list.json>] [vitest list arguments...]'); return 3; }
  const rawAt = rest.indexOf('--raw');
  let text;
  if (rawAt >= 0) text = readFileSync(rest[rawAt + 1], 'utf8');
  else {
    const run = spawnSync('npx', listArgs(rest), { encoding: 'utf8', maxBuffer: 1 << 30 });
    if (run.status !== 0) { console.error(run.stderr); return 1; }
    text = run.stdout;
  }
  const rows = rowsOfList(JSON.parse(text));
  writeFileSync(outPath, JSON.stringify(rows));
  console.log(`${rows.length} rows in ${new Set(rows.map(row => row.file)).size} files`);
  for (const [project, count] of Object.entries(countPerProject(rows)).sort()) console.log(`  ${project}\t${count}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
