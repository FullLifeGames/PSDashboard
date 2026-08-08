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
const LADDER_FORMATS = ['gen9ou', 'gen9doublesou', 'gen9vgc2024regh'];
const PER_FORMAT_CAP = 30;
const LADDER_PER_FORMAT = 25;
const MANIFEST_PATH = 'regression/fixtures/fit-corpus-manifest.json';
const CACHE_DIR = '.fit-corpus';
const DELAY_MS = 300;

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
          if (!/^gen\d(ou|uu|ru|nu|ubers|doublesou|vgc)/.test(format)) continue;
          seen.add(id);
          const bucket = byFormat.get(format) ?? [];
          if (bucket.length < PER_FORMAT_CAP) {
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
        .slice(0, LADDER_PER_FORMAT);
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

const existing = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')).replays
  : [];
if (existing.length > 0) {
  console.log(`manifest already has ${existing.length} replays — refreshing cache only`);
  await download(existing);
} else {
  const tournament = await tournamentTranche();
  const ladder = await ladderTranche();
  const replays = [...tournament, ...ladder];
  writeFileSync(MANIFEST_PATH, JSON.stringify({ replays }, null, 2) + '\n');
  console.log(`manifest written: ${replays.length} replays ` +
    `(${tournament.length} tournament, ${ladder.length} ladder)`);
  await download(replays);
}
