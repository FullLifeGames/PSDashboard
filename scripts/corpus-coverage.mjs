// Round 72 (T237): which rule-bearing populations do the replays of the project contain, and how many replays carry each? A
// population with few or no replays is one in which a rule error is invisible to every measurement.
//
//   node scripts/corpus-coverage.mjs [--bank <run folder>] [--columns fixtures,fit,bank] [--json] [--root <dir>]
//
// Three columns. The fixtures: every .json with a `log` string under the test and e2e fixture folders (one replay once, however many
// folders hold it). The fit corpus: .fit-corpus/*.json. The bank: the unique ids of a run's merged.jsonl (--bank
// .calibration/r72-base), read from the fit corpus or the fixtures when a replay stands there and fetched from
// replay.pokemonshowdown.com into the OS temp folder otherwise (never into .calibration); offline it prints "bank: N ids, not fetched".
// Rows: generation, game type, protocol features, and move classes. A move class is a property of the Dex move (`stallingMove`,
// `callsMove`, ...), counted through the `|move|` lines of a log, so the script types no move name.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Dex } from '@pkmn/dex';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FIXTURE_FOLDERS = [
  'packages/replay-core/test/fixtures',
  'packages/eval-engine/test/fixtures',
  'regression/fixtures',
  'e2e/fixtures',
  'e2e-feedback/fixtures',
  'e2e-feedback/golden',
];

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const GAME_TYPES = ['singles', 'doubles', 'VGC', 'Champions', 'Custom Game'];

/** Protocol features: a label and a test on the parsed log (lines without carriage returns) and the raw text. */
const FEATURES = [
  ['Z-move (zeffect)', ({ lines }) => lines.some(line => line.includes('[zeffect]'))],
  ['Dynamax', ({ lines }) => lines.some(line => /^\|-start\|[^|]*\|Dynamax/.test(line))],
  ['Mega evolution', ({ lines }) => lines.some(line => line.startsWith('|-mega|'))],
  ['Terastallization', ({ lines }) => lines.some(line => line.startsWith('|-terastallize|'))],
  ['a shiny body', ({ switches }) => switches.some(parts => /, shiny(,|$)/.test(parts[2] ?? ''))],
  ['a level other than 100', ({ switches }) => switches.some(parts => /, L\d+(,|$)/.test(parts[2] ?? ''))],
  ['a nickname that differs from the species', ({ switches }) => switches.some(parts => {
    const nick = (parts[1] ?? '').replace(/^p\d[a-d]?:\s*/, '');
    return plain(nick) !== plain((parts[2] ?? '').split(',')[0]);
  })],
  ['CRLF line endings', ({ text }) => text.includes('\r\n')],
];

/** Move classes: a label and a test on a Dex move, by property. */
const MOVE_CLASSES = [
  ['stalling move (Protect family)', move => !!move.stallingMove],
  ['calls another move', move => !!move.callsMove],
  ['switches the user out', move => !!move.selfSwitch],
  ['forces the target out', move => !!move.forceSwitch],
  ['one-hit KO', move => !!move.ohko],
  ['multi-hit', move => !!move.multihit],
  ['drains HP', move => Array.isArray(move.drain)],
  ['heals the user', move => Array.isArray(move.heal)],
  ['sets weather', move => !!move.weather],
  ['sets terrain', move => !!move.terrain],
  ['sets a pseudo-weather (Trick Room, Gravity, ...)', move => !!move.pseudoWeather],
  ['sets a side condition (screens, hazards, ...)', move => !!move.sideCondition],
  ['sets a slot condition', move => !!move.slotCondition],
  ['breaks protection', move => !!move.breaksProtect],
  ['faints the user', move => !!move.selfdestruct],
  ['has a priority other than 0', move => move.priority !== 0],
  ['is a Z-move', move => !!move.isZ],
  ['is a Max move', move => !!move.isMax],
];

function plain(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function moveOf(name) {
  const move = Dex.moves.get(name);
  return move.exists ? move : undefined;
}

function gameTypeOf(lines) {
  const tier = lines.find(line => line.startsWith('|tier|')) ?? '';
  const gametype = lines.find(line => line.startsWith('|gametype|'))?.split('|')[2];
  if (/VGC/i.test(tier)) return 'VGC';
  if (/Champions/i.test(tier)) return 'Champions';
  if (/Custom Game/i.test(tier)) return 'Custom Game';
  return gametype === 'doubles' ? 'doubles' : 'singles';
}

/** The facts of one log that the rows read. */
function readLog(text) {
  const lines = text.split(/\r?\n/);
  const parts = lines.map(line => line.split('|'));
  // [kind, ident, details, ...] of every switch and drag line
  const switches = parts.filter(p => p[1] === 'switch' || p[1] === 'drag').map(p => p.slice(1));
  const moves = new Set();
  for (const p of parts) if (p[1] === 'move' && p[3]) moves.add(p[3]);
  return { text, lines, switches, moves };
}

/**
 * Counts, over replays given as log texts, how many replays carry each population.
 * Returns { total, groups: { generation, 'game type', 'protocol feature', 'move class' } }, each group a map of label to the
 * number of replays; every label is present, with 0 when no replay carries it.
 */
export function coverageOf(logs) {
  const groups = {
    generation: Object.fromEntries([...GENERATIONS.map(gen => [`Gen ${gen}`, 0]), ['unknown', 0]]),
    'game type': Object.fromEntries(GAME_TYPES.map(type => [type, 0])),
    'protocol feature': Object.fromEntries(FEATURES.map(([label]) => [label, 0])),
    'move class': Object.fromEntries(MOVE_CLASSES.map(([label]) => [label, 0])),
  };
  let total = 0;
  for (const text of logs) {
    if (typeof text !== 'string' || !text) continue;
    total++;
    const log = readLog(text);
    const gen = log.lines.find(line => line.startsWith('|gen|'))?.split('|')[2];
    groups.generation[GENERATIONS.includes(Number(gen)) ? `Gen ${Number(gen)}` : 'unknown']++;
    groups['game type'][gameTypeOf(log.lines)]++;
    for (const [label, has] of FEATURES) if (has(log)) groups['protocol feature'][label]++;
    const moves = [...log.moves].map(moveOf).filter(Boolean);
    for (const [label, has] of MOVE_CLASSES) if (moves.some(has)) groups['move class'][label]++;
  }
  return { total, groups };
}

function* jsonFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) yield* jsonFiles(file);
    else if (name.endsWith('.json')) yield file;
  }
}

function logOf(file) {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    return typeof json.log === 'string' ? json.log : '';
  } catch {
    return '';
  }
}

/** The logs of the fixture folders, each distinct log once. */
export function fixtureLogs(root = ROOT) {
  const seen = new Set();
  const logs = [];
  for (const folder of FIXTURE_FOLDERS) {
    for (const file of jsonFiles(path.join(root, folder))) {
      const log = logOf(file);
      const key = createHash('sha1').update(log).digest('hex');
      if (!log || seen.has(key)) continue;
      seen.add(key);
      logs.push(log);
    }
  }
  return logs;
}

/** The logs of .fit-corpus; empty when the folder is absent. */
export function fitCorpusLogs(root = ROOT) {
  const dir = path.join(root, '.fit-corpus');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.json')).map(name => logOf(path.join(dir, name))).filter(Boolean);
}

/** The unique replay ids of a calibration run (merged.jsonl, or the slices when it is not merged yet). */
export function bankIds(runFolder) {
  const merged = path.join(runFolder, 'merged.jsonl');
  const files = existsSync(merged) ? [merged] : readdirSync(runFolder).filter(name => /^slice-\d+\.jsonl$/.test(name)).map(name => path.join(runFolder, name));
  const ids = new Set();
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { ids.add(JSON.parse(line).id); } catch { /* a torn last line */ }
    }
  }
  return [...ids].filter(id => typeof id === 'string').sort();
}

/** The logs of a run's replays: from the fit corpus or a fixture when one stands there, else fetched into the OS temp folder. */
export async function bankLogs(runFolder, root = ROOT, { fetcher = fetch } = {}) {
  const ids = bankIds(runFolder);
  const cache = path.join(os.tmpdir(), 'ps-dashboard-bank-replays');
  mkdirSync(cache, { recursive: true });
  const local = new Map();
  for (const folder of ['.fit-corpus', ...FIXTURE_FOLDERS]) for (const file of jsonFiles(path.join(root, folder))) local.set(path.basename(file, '.json'), file);
  const logs = [];
  let missing = 0;
  for (const id of ids) {
    const file = local.get(id) ?? path.join(cache, `${id}.json`);
    let log = existsSync(file) ? logOf(file) : '';
    if (!log) {
      try {
        const response = await fetcher(`https://replay.pokemonshowdown.com/${id}.json`);
        if (response.ok) {
          const json = await response.json();
          writeFileSync(path.join(cache, `${id}.json`), JSON.stringify(json));
          log = typeof json.log === 'string' ? json.log : '';
        }
      } catch { /* offline */ }
    }
    if (log) logs.push(log); else missing++;
  }
  return { ids: ids.length, missing, logs };
}

function table(columns) {
  const labels = [];
  for (const column of columns) for (const [group, rows] of Object.entries(column.groups)) for (const label of Object.keys(rows)) if (!labels.some(l => l.group === group && l.label === label)) labels.push({ group, label });
  const lines = [];
  lines.push(`${'replays'.padEnd(52)}${columns.map(c => `${c.name}: ${c.total}`.padStart(22)).join('')}`);
  let group = '';
  for (const { group: g, label } of labels) {
    if (g !== group) { group = g; lines.push(`-- ${g}`); }
    const cells = columns.map(column => {
      const count = column.groups[g]?.[label];
      if (count === undefined) return '-'.padStart(22);
      const percent = column.total ? (count / column.total * 100).toFixed(1) : '0.0';
      return `${String(count).padStart(6)} ${percent.padStart(5)}%`.padStart(22);
    });
    lines.push(`${label.padEnd(52)}${cells.join('')}`);
  }
  return lines.join('\n');
}

async function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('--root') ? path.resolve(arg('--root')) : ROOT;
  const bank = arg('--bank');
  const wanted = (arg('--columns') ?? (bank ? 'bank,fit,fixtures' : 'fit,fixtures')).split(',');
  const columns = [];
  const notes = [];
  for (const name of wanted) {
    if (name === 'bank') {
      if (!bank) { notes.push('bank: no --bank <run folder>'); continue; }
      const { ids, missing, logs } = await bankLogs(path.resolve(root, bank), root);
      if (!logs.length) notes.push(`bank: ${ids} ids, not fetched`);
      else columns.push({ name: 'bank', ...coverageOf(logs) });
      if (logs.length && missing) notes.push(`bank: ${missing} of ${ids} ids not fetched`);
    } else if (name === 'fit') {
      const logs = fitCorpusLogs(root);
      if (logs.length) columns.push({ name: 'fit corpus', ...coverageOf(logs) }); else notes.push('fit corpus: no .fit-corpus folder');
    } else if (name === 'fixtures') {
      columns.push({ name: 'fixtures', ...coverageOf(fixtureLogs(root)) });
    } else {
      throw new Error(`unknown column ${name}`);
    }
  }
  if (argv.includes('--json')) console.log(JSON.stringify({ columns, notes }, null, 2));
  else {
    if (columns.length) console.log(table(columns));
    for (const note of notes) console.log(note);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
