// Round 65: the holdout of the weight-fitting corpus. One third of the corpus's SETS (the games two players
// play against each other in one format family, so a Bo3 never splits) in every family the calibration bank
// cannot judge on its own (Doubles OU, Scarlet/Violet VGC, Champions VGC, Champions OU) leaves the fit for
// good and becomes a test bank: the calibration harness reads it with EVAL_CALIBRATION_SOURCE=holdout and the
// fit (regression/eval-fit.spec.ts) drops every holdout id. The bank's own doubles tranche holds 36 Doubles OU
// and 10 VGC games and no Champions game; round 65 showed that its 15 games with Screens or Trick Room decide
// every doubles verdict on those weights and run against the 308-game corpus (docs/perf/probes/2026-10-09-r65).
//
// The selection is a pure function of the committed corpus manifest and the cached replays' player names:
// FNV-1a of "<family>|<sorted player ids>", modulo 3, equal to 0. Writes
// regression/fixtures/fit-holdout-manifest.json (COMMITTED, like the corpus manifest).
//
// Run: node scripts/build-fit-holdout.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CORPUS = 'regression/fixtures/fit-corpus-manifest.json';
const OUT = 'regression/fixtures/fit-holdout-manifest.json';
const CACHE_DIR = '.fit-corpus';
/** The formats held out: every doubles format and every Pokémon Champions format (singles included). */
const HOLDOUT_FORMAT = /doubles|vgc|champions/;

/** The family of a held-out format: Champions VGC, Champions OU, Scarlet/Violet VGC or Doubles OU. */
export function familyOf(format) {
  if (/champions/.test(format)) return /vgc/.test(format) ? 'championsvgc' : 'championsou';
  return /vgc/.test(format) ? 'vgc' : 'doublesou';
}

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
writeFileSync(OUT, JSON.stringify({
  note: "Round 65: one third of the fit corpus's sets in every doubles and Champions family, held out of every fit and read as a test bank (scripts/build-fit-holdout.mjs).",
  sets: holdout,
}, null, 1) + '\n');
console.log(`${holdout.length} of ${all.length} sets held out (${missing} replays not cached): ` +
  families.map(family => `${family} ${games(holdout, family)} of ${games(all, family)} games`).join(', ') + ` -> ${OUT}`);
