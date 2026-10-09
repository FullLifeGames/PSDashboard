// Round 65: grows the weight-fitting corpus by one ladder format from the public replay search, highest
// rated first, without touching the tranches scripts/build-fit-corpus.mjs scrapes. The search endpoint
// returns 51 replays a page, newest first; this pages back with `before`, keeps the highest-rated games
// at or above --min-rating, downloads each into .fit-corpus/ and keeps it only when the log has a winner
// and at least --min-turns turns. New entries append to regression/fixtures/fit-corpus-manifest.json
// (append-only, like the builder's --expand): existing entries stay pinned.
//
// Round 66: --sort rating pages the search by rating instead (`sort=rating&page=N`), so a format that
// left the ladder still yields its rated ladder games; newest first only finds the unrated challenges
// played after. Replays of the calibration bank and the feedback corpus never enter (the corpus and the
// bank share no replay), and every new entry carries its rating. On a Bo3 ladder only the deciding game of a set
// carries the rating (games 1 and 2 read 0), so --sort rating there finds the deciding games only, and the fit's
// rule against unrated ladder games (regression/fit-families.ts) would drop the rest of the set.
//
// Run: node scripts/expand-fit-corpus.mjs --format gen9championsou --pages 80 --games 450 --min-rating 1300
//      node scripts/expand-fit-corpus.mjs --format gen9vgc2026regi --sort rating --pages 10 --games 150 --min-turns 6
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST_PATH = 'regression/fixtures/fit-corpus-manifest.json';
/** Files whose quoted replay ids stay out of the corpus: the bank's tranches and the feedback corpus. */
const EXCLUDED_FROM = ['regression/eval-calibration.spec.ts', 'e2e-feedback/corpus.ts'];
const CACHE_DIR = '.fit-corpus';
const DELAY_MS = 300;

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const format = argValue('format');
const pages = Number(argValue('pages', '40'));
const games = Number(argValue('games', '300'));
const minRating = Number(argValue('min-rating', '0'));
const minTurns = Number(argValue('min-turns', '5'));
const sort = argValue('sort', 'newest');
if (!format) throw new Error('--format <id> is required');
if (sort !== 'newest' && sort !== 'rating') throw new Error('--sort is newest or rating');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const known = new Set(manifest.replays.map(entry => entry.id));
const excluded = new Set(EXCLUDED_FROM.flatMap(path => [...readFileSync(path, 'utf8').matchAll(/'((?:[a-z0-9]+-)+\d+)'/g)].map(match => match[1])));

const search = `https://replay.pokemonshowdown.com/search.json?format=${format}`;
const rows = [];
let before = null;
for (let page = 0; page < pages; page++) {
  const url = sort === 'rating' ? `${search}&sort=rating&page=${page + 1}` : `${search}${before ? `&before=${before}` : ''}`;
  const list = await fetchJson(url);
  if (!Array.isArray(list) || list.length === 0) break;
  rows.push(...list.slice(0, 50));
  before = list[Math.min(list.length, 51) - 1].uploadtime;
  if (list.length < 51) break;
  await sleep(DELAY_MS);
}
// The search's pages can shift on an active ladder, so one replay may come back twice: keep its first row.
const seenIds = new Set();
const unique = rows.filter(row => row.id && !seenIds.has(row.id) && seenIds.add(row.id));
const candidates = unique
  .filter(row => !known.has(row.id) && !excluded.has(row.id) && (row.rating ?? 0) >= minRating)
  .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (a.id < b.id ? -1 : 1));
const barred = rows.filter(row => excluded.has(row.id)).length;
console.log(`${format}: ${rows.length} replays searched (${sort}), ${candidates.length} new at rating >= ${minRating}, ${barred} bank or feedback replays left out`);

mkdirSync(CACHE_DIR, { recursive: true });
const added = [];
let rejected = 0;
for (const row of candidates) {
  if (added.length >= games) break;
  const path = join(CACHE_DIR, `${row.id}.json`);
  try {
    const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : await fetchJson(`https://replay.pokemonshowdown.com/${row.id}.json`);
    const winner = data.log?.match(/^\|win\|(.+)$/m)?.[1]?.trim();
    const turns = (data.log?.match(/^\|turn\|/gm) ?? []).length;
    if (!winner || !(data.players ?? []).includes(winner) || turns < minTurns) {
      rejected++;
      continue;
    }
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(data));
    added.push({ id: row.id, format, source: 'ladder', rating: row.rating ?? 0 });
  } catch (error) {
    console.warn(`download ${row.id} failed: ${error.message}`);
    rejected++;
  }
  await sleep(DELAY_MS);
}
manifest.replays.push(...added);
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
const ratings = added.map(entry => entry.rating);
console.log(`added ${added.length} ${format} replays (rejected ${rejected}); ratings ${Math.min(...ratings)} to ${Math.max(...ratings)}; manifest ${manifest.replays.length}`);
