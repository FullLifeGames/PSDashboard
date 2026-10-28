#!/usr/bin/env node
// The command line of @fulllifegames/eval-engine (round 77, user gate 28.10.2026, 6a):
//   npx @fulllifegames/eval-engine check-engine <url> [--budget <ms>] [--origin <origin>]...
// It sends the shipped sample positions (singles, doubles, VGC) to an engine endpoint and checks every
// answer as PS Dashboard reads it, the time against the budget, and CORS for the pages that host the app.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkEngine } from '../dist/index.js';

const [command, url, ...rest] = process.argv.slice(2);
if (command !== 'check-engine' || !url) {
  console.error('usage: eval-engine check-engine <url> [--budget <ms>] [--origin <origin>]...');
  process.exit(2);
}
const valueOf = name => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
const origins = rest.flatMap((arg, index) => (arg === '--origin' && rest[index + 1] ? [rest[index + 1]] : []));
const budget = valueOf('--budget');

const samples = fileURLToPath(new URL('../samples/', import.meta.url));
const positions = readdirSync(samples)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => JSON.parse(readFileSync(`${samples}${name}`, 'utf8')));

const report = await checkEngine(url, {
  positions,
  ...(budget ? { budgetMs: Number(budget) } : {}),
  ...(origins.length > 0 ? { origins } : {}),
});
for (const sample of report.samples) {
  console.log(`${sample.ok ? 'ok  ' : 'FAIL'} ${sample.name} (${sample.ms} ms)`);
  for (const error of sample.errors) console.log(`       ${error}`);
}
for (const entry of report.cors) console.log(`${entry.ok ? 'ok  ' : 'FAIL'} CORS for ${entry.origin}${entry.error ? `: ${entry.error}` : ''}`);
console.log(report.ok ? 'The engine answers the PS Dashboard engine protocol.' : 'The engine does not pass yet.');
// The exit code, not process.exit(): fetch still closes its sockets, and an exit in the middle crashes Node on Windows.
process.exitCode = report.ok ? 0 : 1;
