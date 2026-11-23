// A fold or a split keeps every row. Compares two lists from `rows-collect.mjs` by project and full row name, ignoring the file,
// as multisets, and prints the rows lost, the rows gained and the file each came from.
// Usage: node scripts/rows-compare.mjs <before.json> <after.json> [--map <table.json>]
// Exit 1 when a row is lost or gained. Collect both lists with the same DICE_SWEEPS value.
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
  const [beforePath, afterPath, flag, tablePath] = args;
  if (!beforePath || !afterPath || (flag && (flag !== '--map' || !tablePath))) {
    console.error('usage: rows-compare.mjs <before.json> <after.json> [--map <table.json>]');
    return 3;
  }
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const { rows: beforeRows, unused } = applyTable(read(beforePath), tablePath ? read(tablePath) : {});
  if (unused.length > 0) { for (const entry of unused) console.log(`UNUSED table entry ${entry}`); return 2; }
  const before = bagOf(beforeRows);
  const after = bagOf(read(afterPath));
  let lost = 0;
  let gained = 0;
  for (const [key, files] of before) {
    const left = after.get(key)?.length ?? 0;
    if (left < files.length) { lost += files.length - left; console.log(`LOST ${files.length - left}x ${key} (was in ${files[0]})`); }
  }
  for (const [key, files] of after) {
    const had = before.get(key)?.length ?? 0;
    if (had < files.length) { gained += files.length - had; console.log(`GAINED ${files.length - had}x ${key} (now in ${files[0]})`); }
  }
  console.log(`rows before ${total(before)}, after ${total(after)}, lost ${lost}, gained ${gained}`);
  return lost + gained > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
