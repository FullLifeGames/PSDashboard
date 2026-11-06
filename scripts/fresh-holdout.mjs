// Round 86 (the fresh VGC holdout of the final gate's 1c): draws a holdout family of rated ladder games that no
// measurement has read. The old VGC holdout (scripts/build-fit-holdout.mjs) has judged every VGC choice since round
// 65; this draw takes games from the same formats and seasons that no tracked file, no local note and no
// .fit-corpus file names, so a reading on them is the third sample next to the bank and the old holdout.
//
// The draw rule, written before any measurement:
//   - the public replay search, sort=rating, pages 1 to 20 of each format (50 rows a page);
//   - rows of the main server only (id "<format>-<digits>"; dawn-, smogtours-, china- never enter), with a numeric
//     rating at or above --min-rating (1500), whose id no known set holds;
//   - the formats in the order of FRESH_FORMATS, inside a format by rating, highest first, then by id;
//   - at most one game per player pair over the whole draw (the earlier format keeps a pair);
//   - a game passes when its replay has a winner among its players, at least 6 turns and a rating at the floor;
//     a game that fails leaves the next in line to enter; the quota of a format ends its walk.
// Every game becomes one set "<family>|<player>|<player>" of the holdout manifest, appended after the old sets
// (test/regression/fixtures/fit-holdout-manifest.json); the replays land in .fit-corpus/ and never in the fit
// corpus's manifest. The pure core is exported for test/regression/fresh-holdout.spec.ts.
//
// Run: node scripts/fresh-holdout.mjs --family vgc2 --fetch-listing
//      node scripts/fresh-holdout.mjs --family vgc2 --listing .calibration/fresh-holdout/listing-2026-11-06.json [--dry-run]
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = 'test/regression/fixtures/fit-holdout-manifest.json';
const CACHE_DIR = '.fit-corpus';
const LISTING_DIR = '.calibration/fresh-holdout';
const DELAY_MS = 300;
const PAGES = 20;
const MIN_RATING = 1500;
const MIN_TURNS = 6;
const HQ_RATING = 1700;

/**
 * The formats in the draw's order with their quotas: the old holdout's seven formats at three times its games
 * (user gate 06.11.2026, 2a), then gen9vgc2025regj, a format the old holdout never held, kept apart (1c).
 */
export const FRESH_FORMATS = [
  { format: 'gen9vgc2026regi', quota: 264 },
  { format: 'gen9vgc2026regf', quota: 195 },
  { format: 'gen9vgc2025regi', quota: 156 },
  { format: 'gen9vgc2025regh', quota: 108 },
  { format: 'gen9vgc2024regg', quota: 165 },
  { format: 'gen9vgc2024regh', quota: 171 },
  { format: 'gen9vgc2025regg', quota: 186 },
  { format: 'gen9vgc2025regj', quota: 165 },
];

const playerId = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The player pair of a game, the rule of scripts/build-fit-holdout.mjs: sorted player ids. */
export const pairKey = players => players.map(playerId).sort().join('|');

/** Every Scarlet/Violet VGC replay id a text quotes, with and without its server or tournament prefix. */
export function idsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(/\b((?:[a-z]+-)?)(gen9[a-z0-9]*vgc[a-z0-9]*-\d{6,})/g)) {
    found.add(match[2]);
    if (match[1]) found.add(match[1] + match[2]);
  }
  return [...found];
}

/** The rows of one format that can enter: main server, rated at the floor, not known; the first row of an id counts. */
export function eligibleRows(listing, known, { format, minRating = MIN_RATING }) {
  const pattern = new RegExp(`^${format}-\\d+$`);
  const sorted = listing
    .filter(row => typeof row.id === 'string' && pattern.test(row.id) && typeof row.rating === 'number' && row.rating >= minRating && !known.has(row.id))
    .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : 1));
  const seen = new Set();
  return sorted.filter(row => !seen.has(row.id) && seen.add(row.id));
}

/** The ordered candidates per format; the listing's own order never matters. */
export function drawCandidates(listing, known, { formats = FRESH_FORMATS, minRating = MIN_RATING } = {}) {
  return formats.map(({ format, quota }) => ({
    format,
    quota,
    candidates: eligibleRows(listing, known, { format, minRating }).map(row => ({
      id: row.id, rating: row.rating, players: row.players ?? [], pair: row.players?.length === 2 ? pairKey(row.players) : `id:${row.id}`,
    })),
  }));
}

/**
 * Walks each format's candidates in order and keeps a game when its pair is free and `check(game)` passes (it may be
 * async), until the quota. A pair is taken only by a game that enters; a failed check frees nothing and takes nothing.
 */
export async function takeChecked(lists, check) {
  const taken = new Set();
  const result = [];
  for (const { format, quota, candidates } of lists) {
    const games = [];
    let rejected = 0;
    let skippedPairs = 0;
    for (const game of candidates) {
      if (games.length >= quota) break;
      if (taken.has(game.pair)) {
        skippedPairs++;
        continue;
      }
      if (!(await check(game))) {
        rejected++;
        continue;
      }
      taken.add(game.pair);
      games.push(game);
    }
    result.push({ format, quota, games, rejected, skippedPairs, short: quota - games.length });
  }
  return result;
}

/** Whether a downloaded replay can serve: a winner among its players, enough turns and a rating at the floor. */
export function checkReplay(data, { minTurns = MIN_TURNS, minRating = MIN_RATING } = {}) {
  const winner = data.log?.match(/^\|win\|(.+)$/m)?.[1]?.trim();
  const turns = (data.log?.match(/^\|turn\|/gm) ?? []).length;
  return Boolean(winner) && (data.players ?? []).includes(winner) && turns >= minTurns
    && typeof data.rating === 'number' && data.rating >= minRating;
}

/**
 * The manifest with a new family appended after its old sets (which stay byte for byte). `drawn` records the rule
 * of each appended family, so scripts/build-fit-holdout.mjs keeps it. A family drawn once is never drawn again.
 */
export function appendFamily(manifest, family, games, description) {
  if (manifest.sets.some(set => set.family === family)) throw new Error(`family ${family} is already drawn; a holdout is drawn once`);
  const held = new Set(manifest.sets.flatMap(set => set.ids));
  const added = games.map(game => {
    if (held.has(game.id)) throw new Error(`${game.id} is already in the manifest`);
    return { key: `${family}|${game.players.map(playerId).sort().join('|')}`, family, ids: [game.id] };
  });
  const keys = new Set(manifest.sets.map(set => set.key));
  for (const set of added) {
    if (keys.has(set.key)) throw new Error(`set ${set.key} is already in the manifest`);
    keys.add(set.key);
  }
  return { ...manifest, sets: [...manifest.sets, ...added], drawn: { ...manifest.drawn, [family]: description } };
}

// The command line: network, files and git.

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/** Pages the replay search of each format by rating; 51 rows come back a page and the 51st only marks another page. */
async function fetchListing(formats) {
  const rows = [];
  for (const { format } of formats) {
    for (let page = 1; page <= PAGES; page++) {
      const list = await fetchJson(`https://replay.pokemonshowdown.com/search.json?format=${format}&sort=rating&page=${page}`);
      if (!Array.isArray(list) || list.length === 0) break;
      rows.push(...list.slice(0, 50));
      if (list.length < 51) break;
      await sleep(DELAY_MS);
    }
    console.log(`${format}: ${rows.filter(row => row.format === format || String(row.id).startsWith(`${format}-`)).length} rows listed`);
  }
  return rows;
}

/** The ids a draw must not take: tracked files at HEAD, local notes under docs/, and every file of .fit-corpus/. */
function knownIds() {
  const known = new Set();
  let grep = '';
  try {
    grep = execFileSync('git', ['grep', '-hoE', '(dawn-|china-|smogtours-)?gen9[a-z0-9]*vgc[a-z0-9]*-[0-9]{6,}'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
  } catch (error) {
    if (error.status !== 1) throw error; // git grep exits 1 when nothing matches
  }
  for (const id of idsIn(grep)) known.add(id);
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(md|txt|json|jsonl|mjs|ts)$/.test(name) && stat.size < 20 << 20) for (const id of idsIn(readFileSync(path, 'utf8'))) known.add(id);
    }
  };
  if (existsSync(join(ROOT, 'docs'))) walk(join(ROOT, 'docs'));
  if (existsSync(join(ROOT, CACHE_DIR))) for (const file of readdirSync(join(ROOT, CACHE_DIR))) if (file.endsWith('.json')) known.add(file.slice(0, -5));
  return known;
}

async function main() {
  const family = argValue('family');
  if (!family) throw new Error('--family <name> is required');
  const dryRun = process.argv.includes('--dry-run');
  const manifestPath = join(ROOT, MANIFEST);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  appendFamily(manifest, family, [], '');
  const date = new Date().toISOString().slice(0, 10);
  let listing;
  if (process.argv.includes('--fetch-listing')) {
    listing = await fetchListing(FRESH_FORMATS);
    mkdirSync(join(ROOT, LISTING_DIR), { recursive: true });
    const file = join(ROOT, LISTING_DIR, `listing-${date}.json`);
    writeFileSync(file, JSON.stringify({ date, rows: listing }));
    console.log(`listing of ${listing.length} rows -> ${file}`);
  } else {
    const file = argValue('listing');
    if (!file) throw new Error('give --fetch-listing or --listing <file>');
    listing = JSON.parse(readFileSync(resolve(file), 'utf8')).rows;
  }
  const known = knownIds();
  const lists = drawCandidates(listing, known);
  console.log(`${known.size} known ids; candidates ${lists.map(entry => `${entry.format} ${entry.candidates.length}`).join(', ')}`);
  if (dryRun) return;
  mkdirSync(join(ROOT, CACHE_DIR), { recursive: true });
  const check = async game => {
    const path = join(ROOT, CACHE_DIR, `${game.id}.json`);
    try {
      const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : await fetchJson(`https://replay.pokemonshowdown.com/${game.id}.json`);
      if (!checkReplay(data)) return false;
      if (!existsSync(path)) writeFileSync(path, JSON.stringify(data));
      return true;
    } catch (error) {
      console.warn(`download ${game.id} failed: ${error.message}`);
      return false;
    } finally {
      await sleep(DELAY_MS);
    }
  };
  const drawn = await takeChecked(lists, check);
  const games = drawn.flatMap(entry => entry.games);
  const description = `Round 86: ${games.length} rated games of the searched ladders that no measurement read, drawn ${date} by scripts/fresh-holdout.mjs `
    + '(rating floor 1500, highest rated first per format, one game per player pair).';
  writeFileSync(manifestPath, JSON.stringify(appendFamily(manifest, family, games, description), null, 1) + '\n');
  for (const entry of drawn) {
    const ratings = entry.games.map(game => game.rating);
    const hq = entry.games.filter(game => game.rating >= HQ_RATING).length;
    console.log(`${entry.format}: ${entry.games.length} of ${entry.quota} games, ratings ${Math.min(...ratings)} to ${Math.max(...ratings)}, hq ${hq}, `
      + `${entry.rejected} failed their check, ${entry.skippedPairs} skipped for a pair, ${entry.short} short`);
  }
  const hqAll = games.filter(game => game.rating >= HQ_RATING).length;
  console.log(`${games.length} games, hq share ${(100 * hqAll / Math.max(1, games.length)).toFixed(1)} % -> ${MANIFEST}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
