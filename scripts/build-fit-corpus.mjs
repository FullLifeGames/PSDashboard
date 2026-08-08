// Builds the manifest-pinned fitting corpus for the eval weight fit
// (regression/eval-fit.spec.ts). Two tranches:
//  - tournament: Smogon tournament replays via the ReplayScouter static data
//    (fulllifegames.com/Tools/TournamentTeams) — cleanest outcome labels.
//  - ladder: top-rated replays from the replay search API.
// Writes regression/fixtures/fit-corpus-manifest.json (COMMITTED — pins the
// corpus so fits are reproducible; run-to-run corpus drift poisons
// comparisons) and caches replay JSONs in .fit-corpus/ (gitignored).
//
// Run: node scripts/build-fit-corpus.mjs

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCOUTER_BASE = 'https://fulllifegames.com/Tools/TournamentTeams/Tournaments';
// Per-tier tournament replay archives (thousands of smogtours games each).
const TOURNAMENT_THREADS = [
  3766306, // (2023-current) RU Tournament Replays
  3718010, // SS OU Tournament Replays
  3689202, // SM OU Tournament Replays
  3688222, // DPP OU Tournament Replays
  3688023, // ORAS Tournament Replays
  3689138, // GSC Tournament Replays
  3768371, // (2020-2022 Archive) RU Tournament Replays
  3768373, // (2017-2019 Archive) RU Tournament Replays
];
// Doubles/VGC replay threads scraped DIRECTLY from the Smogon forums —
// the ReplayScouter cache only carries threads someone already requested.
// NPA 15 (VGC 2026 Reg M-A, Bo3) weeks 1-9 + finals, plus the Official
// Smogon Doubles Tournament replay threads (gen9doublesou).
const SMOGON_DOUBLES_THREADS = [
  3781957, 3782292, 3782626, 3782999, 3783387, // NPA 15 weeks 1-5
  3783695, 3784363, 3784687, 3785004, 3785603, // NPA 15 weeks 6-9 + finals
  3778554, // Official Smogon Doubles Tournament - Replays and Usage Stats
  3781999, // OSDT VI Play-In (replays required)
];
const LADDER_FORMATS = ['gen9ou', 'gen9doublesou', 'gen9vgc2024regh', 'gen9vgc2026regm'];
const FORMAT_FILTER = /^gen\d(ou|uu|ru|nu|ubers|doublesou|vgc|champions)/;
const DOUBLES_FORMAT = /doubles|vgc|champions/;
const PER_FORMAT_CAP = 30;
// The doubles tranche is the corpus's scarce resource — cap far higher.
const DOUBLES_PER_FORMAT_CAP = 150;
const LADDER_PER_FORMAT = 25;
const MANIFEST_PATH = 'regression/fixtures/fit-corpus-manifest.json';
const CACHE_DIR = '.fit-corpus';
const DELAY_MS = 300;

const formatCap = format => (DOUBLES_FORMAT.test(format) ? DOUBLES_PER_FORMAT_CAP : PER_FORMAT_CAP);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function tournamentTranche() {
  const byFormat = new Map();
  const seen = new Set();
  for (const thread of TOURNAMENT_THREADS) {
    try {
      const data = await fetchJson(`${SCOUTER_BASE}/${thread}.json`);
      const teams = data.Teams ?? data.teams ?? [];
      for (const team of teams) {
        for (const replay of team.Replays ?? team.replays ?? []) {
          const id = replay.Id ?? replay.id;
          const format = (replay.FormatId ?? replay.formatId ?? '').toLowerCase();
          if (!id || !format || seen.has(id)) continue;
          // Singles + doubles main formats only; skip randoms and odd metas.
          if (!FORMAT_FILTER.test(format)) continue;
          seen.add(id);
          const bucket = byFormat.get(format) ?? [];
          if (bucket.length < formatCap(format)) {
            bucket.push({ id, format, source: 'tournament' });
            byFormat.set(format, bucket);
          }
        }
      }
      console.log(`thread ${thread}: corpus now ${[...byFormat.values()].flat().length} replays`);
    } catch (error) {
      console.warn(`thread ${thread} failed: ${error.message}`);
    }
    await sleep(DELAY_MS);
  }
  return [...byFormat.values()].flat();
}

/** Replay links scraped straight from paginated Smogon threads. */
async function smogonThreadTranche() {
  const byFormat = new Map();
  const seen = new Set();
  const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
  for (const thread of SMOGON_DOUBLES_THREADS) {
    try {
      const base = `https://www.smogon.com/forums/threads/${thread}/`;
      const first = await (await fetch(base, { headers })).text();
      const lastPage = Math.max(1, ...[...first.matchAll(/page-(\d+)/g)].map(m => parseInt(m[1], 10)));
      const pages = [first];
      for (let page = 2; page <= lastPage; page++) {
        await sleep(DELAY_MS);
        pages.push(await (await fetch(`${base}page-${page}`, { headers })).text());
      }
      let found = 0;
      for (const html of pages) {
        for (const match of html.matchAll(/replay\.pokemonshowdown\.com\/([a-z0-9]+-\d+[a-z0-9-]*)/g)) {
          const id = match[1];
          const format = id.split(/-\d/)[0];
          if (!FORMAT_FILTER.test(format) || seen.has(id)) continue;
          seen.add(id);
          const bucket = byFormat.get(format) ?? [];
          if (bucket.length < formatCap(format)) {
            bucket.push({ id, format, source: 'tournament' });
            byFormat.set(format, bucket);
            found += 1;
          }
        }
      }
      console.log(`smogon thread ${thread}: +${found} replays (${lastPage} pages)`);
    } catch (error) {
      console.warn(`smogon thread ${thread} failed: ${error.message}`);
    }
    await sleep(DELAY_MS);
  }
  return [...byFormat.values()].flat();
}

async function ladderTranche() {
  const entries = [];
  for (const format of LADDER_FORMATS) {
    try {
      // The search endpoint returns newest public replays for the format;
      // sort by rating client-side (the API's own sort params are unstable).
      const rows = await fetchJson(`https://replay.pokemonshowdown.com/search.json?format=${format}`);
      const list = (Array.isArray(rows) ? rows : rows.replays ?? [])
        .filter(row => row.id)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, DOUBLES_FORMAT.test(format) ? 50 : LADDER_PER_FORMAT);
      for (const row of list) entries.push({ id: row.id, format, source: 'ladder' });
      console.log(`ladder ${format}: ${list.length} replays`);
    } catch (error) {
      console.warn(`ladder ${format} failed: ${error.message}`);
    }
    await sleep(DELAY_MS);
  }
  return entries;
}

async function download(replays) {
  mkdirSync(CACHE_DIR, { recursive: true });
  let fetched = 0;
  let failed = 0;
  for (const entry of replays) {
    const path = join(CACHE_DIR, `${entry.id}.json`);
    if (existsSync(path)) continue;
    try {
      const data = await fetchJson(`https://replay.pokemonshowdown.com/${entry.id}.json`);
      writeFileSync(path, JSON.stringify(data));
      fetched += 1;
    } catch (error) {
      console.warn(`download ${entry.id} failed: ${error.message}`);
      failed += 1;
    }
    await sleep(DELAY_MS);
  }
  console.log(`downloaded ${fetched} new replays (${failed} failed)`);
}

// The manifest is append-only: existing entries stay pinned (corpus drift
// poisons run-to-run comparisons); `--expand` merges newly discovered
// replays on top and re-pins.
const expand = process.argv.includes('--expand');
const existing = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')).replays
  : [];
if (existing.length > 0 && !expand) {
  console.log(`manifest already has ${existing.length} replays — refreshing cache only (use --expand to grow it)`);
  await download(existing);
} else {
  const tournament = await tournamentTranche();
  const smogonThreads = await smogonThreadTranche();
  const ladder = await ladderTranche();
  const known = new Set(existing.map(entry => entry.id));
  const fresh = [...tournament, ...smogonThreads, ...ladder].filter(entry => {
    if (known.has(entry.id)) return false;
    known.add(entry.id);
    return true;
  });
  const replays = [...existing, ...fresh];
  writeFileSync(MANIFEST_PATH, JSON.stringify({ replays }, null, 2) + '\n');
  console.log(`manifest written: ${replays.length} replays (${existing.length} kept, ${fresh.length} new)`);
  await download(replays);
}
