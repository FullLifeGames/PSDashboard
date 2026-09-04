// Round 15 sighting (round 33): every calibration position whose decided
// side LOST, classified from the rest of the protocol:
//   node scripts/dossier-decided-losses.mjs .calibration/r33-block1/merged.jsonl > docs/perf/2026-09-04-decided-losses.md
// Replays come from the fit-corpus cache or the replay server (cached
// under .calibration/replays/). Classes: roll (crit / miss / full-para /
// freeze / flinch against the sweeper before it fainted), pair (the
// sweeper fainted to a pair the clocks called won: no roll line before its
// faint), unplayed (the sweeper was switched out or never attacked before
// the loss), forfeit (a forfeit or timer line), unclear.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { load } from './calibration-lib.mjs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dossier-decided-losses.mjs <merged.jsonl>');
  process.exit(1);
}

/** The replay's JSON: the fit-corpus cache, else the bench's own cache, else the replay server (cached). */
async function replayJson(id) {
  const fit = `.fit-corpus/${id}.json`;
  if (existsSync(fit)) return JSON.parse(readFileSync(fit, 'utf8'));
  const cached = `.calibration/replays/${id}.json`;
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  const response = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
  if (!response.ok) return null;
  const body = await response.text();
  mkdirSync('.calibration/replays', { recursive: true });
  writeFileSync(cached, body);
  return JSON.parse(body);
}

const samples = load(path).filter(s => s.decided && (s.decided === 'p1') !== s.p1Won);
console.log('| id | turn | decided | sweeper | class | evidence |');
console.log('|---|---|---|---|---|---|');
const tally = {};
const book = (cls) => { tally[cls] = (tally[cls] ?? 0) + 1; };
for (const s of samples) {
  const replay = await replayJson(s.id);
  if (!replay) {
    book('unclear');
    console.log(`| ${s.id} | ${s.turn} | ${s.decided} | ? | unclear | replay unavailable |`);
    continue;
  }
  const log = replay.log.split('\n');
  const start = log.indexOf(`|turn|${s.turn}`);
  const tail = start >= 0 ? log.slice(start) : log;
  const side = s.decided;
  const activeLine = [...log.slice(0, Math.max(0, start))].reverse()
    .find(l => l.startsWith(`|switch|${side}a:`) || l.startsWith(`|drag|${side}a:`));
  const sweeper = activeLine ? activeLine.split('|')[2].split(':')[1].trim() : '?';
  const faintAt = tail.findIndex(l => l.startsWith(`|faint|${side}a: ${sweeper}`));
  const before = faintAt >= 0 ? tail.slice(0, faintAt) : tail;
  const roll = before.find(l =>
    (l.startsWith('|-crit|') && l.includes(`${side}a:`)) ||
    l.startsWith(`|-miss|${side}a:`) ||
    l.startsWith(`|cant|${side}a:`));
  const forfeit = tail.find(l => /forfeit|timer/i.test(l));
  const switched = before.find(l => l.startsWith(`|switch|${side}a:`));
  const cls = forfeit ? 'forfeit' : roll ? 'roll' : faintAt >= 0 ? 'pair' : switched ? 'unplayed' : 'unclear';
  book(cls);
  const evidence = (forfeit ?? roll ?? tail[faintAt] ?? switched ?? '').slice(0, 60).replace(/\|/g, '/');
  console.log(`| ${s.id} | ${s.turn} | ${side} | ${sweeper} | ${cls} | ${evidence} |`);
}
console.log(`\n${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ')} of ${samples.length}`);
