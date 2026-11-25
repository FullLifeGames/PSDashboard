// Draws the fit corpus's holdout: a third of the sets of every held-out family, chosen by a hash of family and players.
// A family drawn by scripts/fresh-holdout.mjs (vgc2) is no function of the corpus: a rebuild keeps its sets and notes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CORPUS = 'test/regression/fixtures/fit-corpus-manifest.json';
const OUT = 'test/regression/fixtures/fit-holdout-manifest.json';
const CACHE_DIR = '.fit-corpus';
const HOLDOUT_FORMAT = /doubles|vgc|champions/;

function familyOf(format) {
  if (/champions/.test(format)) return /vgc/.test(format) ? 'championsvgc' : 'championsou';
  return /vgc/.test(format) ? 'vgc' : 'doublesou';
}

const OWN_FAMILIES = ['championsou', 'championsvgc', 'doublesou', 'vgc'];

const playerId = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const manifest = JSON.parse(readFileSync(CORPUS, 'utf8'));
const sets = new Map();
let missing = 0;
for (const entry of manifest.replays) {
  if (!HOLDOUT_FORMAT.test(entry.format)) continue;
  const path = join(CACHE_DIR, `${entry.id}.json`);
  if (!existsSync(path)) {
    missing++;
    continue;
  }
  const { players = [] } = JSON.parse(readFileSync(path, 'utf8'));
  const family = familyOf(entry.format);
  const key = `${family}|${players.map(playerId).sort().join('|')}`;
  const set = sets.get(key) ?? { key, family, ids: [] };
  set.ids.push(entry.id);
  sets.set(key, set);
}
const all = [...sets.values()];
const holdout = all.filter(set => fnv1a(set.key) % 3 === 0).sort((a, b) => (a.key < b.key ? -1 : 1));
const games = (list, family) => list.filter(set => set.family === family).reduce((sum, set) => sum + set.ids.length, 0);
const families = [...new Set(all.map(set => set.family))].sort();
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { sets: [] };
const kept = previous.sets.filter(set => !OWN_FAMILIES.includes(set.family));
writeFileSync(OUT, JSON.stringify({
  note: "Round 65: one third of the fit corpus's sets in every doubles and Champions family, held out of every fit and read as a test bank (scripts/build-fit-holdout.mjs).",
  sets: [...holdout, ...kept],
  ...(previous.drawn ? { drawn: previous.drawn } : {}),
}, null, 1) + '\n');
console.log(`${holdout.length} of ${all.length} sets held out (${missing} replays not cached, ${kept.length} drawn sets kept): ` +
  families.map(family => `${family} ${games(holdout, family)} of ${games(all, family)} games`).join(', ') + ` -> ${OUT}`);
