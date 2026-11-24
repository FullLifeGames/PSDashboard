// A fold or a split keeps every row. Compares two lists from `rows-collect.mjs` by project and full row name, ignoring the file,
// as multisets, and prints the rows lost, the rows gained and the file each came from.
// Usage: node scripts/rows-compare.mjs <before.json> <after.json> [--map <table.json>] [--expect-lost <names.json>] [--expect-gained <names.json>]
// Exit 1 when a row is lost or gained. `--expect-lost` reads a JSON array of "<project> | <row name>" (one entry per row, repeated for a row
// counted twice) that a cut removes on purpose: exit 0 only when exactly those rows are lost and none is gained. `--expect-gained` is its mirror
// for rows a change adds on purpose: exit 0 only when exactly those rows are gained and none is lost. With both flags, exactly the named rows are lost and exactly the named rows are gained.
// Collect both lists with the same DICE_SWEEPS value.
// The table maps renamed rows from before to after: { "rows": { "<old name>": "<new name>" }, "prefixes": { "<old start>": "<new start>" } }.
// An exact row wins; else the longest prefix that the old name starts with. A table entry that matches no row is an error (exit 2).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function applyTable(rows, table = {}) {
  const exact = table.rows ?? {};
  const prefixes = Object.entries(table.prefixes ?? {}).sort((a, b) => b[0].length - a[0].length);
  const used = new Set();
  const mapped = rows.map(row => {
    if (Object.hasOwn(exact, row.name)) { used.add(row.name); return { ...row, name: exact[row.name] }; }
    const prefix = prefixes.find(([from]) => row.name.startsWith(from));
    if (!prefix) return row;
    used.add(prefix[0]);
    return { ...row, name: prefix[1] + row.name.slice(prefix[0].length) };
  });
  const unused = [...Object.keys(exact), ...Object.keys(table.prefixes ?? {})].filter(entry => !used.has(entry));
  return { rows: mapped, unused };
}

const keyOf = row => `${row.projectName ?? '-'} | ${row.name}`;
const bagOf = rows => rows.reduce((bag, row) => bag.set(keyOf(row), [...(bag.get(keyOf(row)) ?? []), row.file]), new Map());
const total = bag => [...bag.values()].reduce((sum, files) => sum + files.length, 0);

function main(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--map' || args[i] === '--expect-lost' || args[i] === '--expect-gained') flags[args[i]] = args[++i] ?? ''; else positional.push(args[i]);
  }
  const [beforePath, afterPath, ...extra] = positional;
  if (!beforePath || !afterPath || extra.length > 0 || Object.values(flags).includes('')) {
    console.error('usage: rows-compare.mjs <before.json> <after.json> [--map <table.json>] [--expect-lost <names.json>] [--expect-gained <names.json>]');
    return 3;
  }
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const { rows: beforeRows, unused } = applyTable(read(beforePath), flags['--map'] ? read(flags['--map']) : {});
  if (unused.length > 0) { for (const entry of unused) console.log(`UNUSED table entry ${entry}`); return 2; }
  const countNames = path => {
    const counts = new Map();
    for (const name of path ? read(path) : []) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  };
  const expected = countNames(flags['--expect-lost']);
  const expectedGain = countNames(flags['--expect-gained']);
  const before = bagOf(beforeRows);
  const after = bagOf(read(afterPath));
  let lost = 0;
  let gained = 0;
  let unexpected = 0;
  let matched = 0;
  let unexpectedGain = 0;
  let matchedGain = 0;
  for (const [key, files] of before) {
    const left = after.get(key)?.length ?? 0;
    if (left >= files.length) continue;
    const missing = files.length - left;
    const named = Math.min(missing, expected.get(key) ?? 0);
    lost += missing;
    matched += named;
    unexpected += missing - named;
    expected.delete(key);
    console.log(`LOST ${missing}x ${key} (was in ${files[0]})${named > 0 ? ', expected' : ''}`);
  }
  for (const [key, files] of after) {
    const had = before.get(key)?.length ?? 0;
    if (had >= files.length) continue;
    const added = files.length - had;
    const named = Math.min(added, expectedGain.get(key) ?? 0);
    gained += added;
    matchedGain += named;
    unexpectedGain += added - named;
    expectedGain.delete(key);
    console.log(`GAINED ${added}x ${key} (now in ${files[0]})${named > 0 ? ', expected' : ''}`);
  }
  let notLost = 0;
  for (const [key, count] of expected) { notLost += count; console.log(`NOT LOST ${count}x ${key} (named in --expect-lost)`); }
  let notGained = 0;
  for (const [key, count] of expectedGain) { notGained += count; console.log(`NOT GAINED ${count}x ${key} (named in --expect-gained)`); }
  console.log(`rows before ${total(before)}, after ${total(after)}, lost ${lost}, gained ${gained}`);
  const wanted = flags['--expect-lost'] !== undefined;
  if (wanted) console.log(`lost ${matched} of ${matched + notLost} expected, unexpected ${unexpected}, gained ${gained}`);
  const wantedGain = flags['--expect-gained'] !== undefined;
  if (wantedGain) console.log(`gained ${matchedGain} of ${matchedGain + notGained} expected, unexpected ${unexpectedGain}`);
  const lostBad = wanted ? unexpected + notLost : lost;
  const gainedBad = wantedGain ? unexpectedGain + notGained : gained;
  return lostBad + gainedBad > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
