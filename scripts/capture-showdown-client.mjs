import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutTablePart } from '../src/lib/teambuilder-table.ts';

const HOST = 'https://play.pokemonshowdown.com';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'e2e', 'fixtures', 'showdown-client');
const TABLE_PATH = '/data/teambuilder-tables.js';

const check = process.argv[2] === '--check';
if (process.argv.length > (check ? 3 : 2)) {
  console.error('Usage: node scripts/capture-showdown-client.mjs [--check]');
  process.exit(2);
}

async function get(path) {
  const response = await fetch(`${HOST}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const embed = await get('/js/replay-embed.js');
const paths = [...embed.toString('utf8').matchAll(/(?:linkStyle|requireScript)\('https:\/\/play\.pokemonshowdown\.com([^'?]+)/g)].map(match => match[1]);
if (paths.length < 15 || !paths.includes(TABLE_PATH)) throw new Error(`The embed lists ${paths.length} files: its loader changed, read it first.`);

const files = new Map([['/js/replay-embed.js', embed]]);
for (const path of paths) {
  if (path !== TABLE_PATH) files.set(path, await get(path));
}

const exports = {};
new Function('exports', (await get(TABLE_PATH)).toString('utf8'))(exports);
const cut = cutTablePart(exports.BattleTeambuilderTable);
files.set(TABLE_PATH, Buffer.from(`exports.BattleTeambuilderTable = JSON.parse(${JSON.stringify(JSON.stringify(cut))});\n`));

if (check) {
  const differing = [];
  for (const [path, body] of files) {
    const recorded = await readFile(join(OUT, `${path}.fixture`)).catch(() => null);
    if (!recorded || !recorded.equals(body)) differing.push(path);
  }
  console.log(differing.length ? `differs from the live client:\n${differing.join('\n')}` : `${files.size} files equal the live client`);
  process.exit(differing.length ? 1 : 0);
}

await rm(OUT, { recursive: true, force: true });
for (const [path, body] of files) {
  const file = join(OUT, `${path}.fixture`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  console.log(`${path} ${body.length} bytes`);
}
