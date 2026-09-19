// The tier census of feedback dump folders (standing rule D21).
//   node scripts/tier-census.mjs <folder> [<folder>...]        counts per replay, per game type and in total
//   node scripts/tier-census.mjs --moved <base> <next>         the turns whose verdict moved between two folders
// A folder holds the feedback-full-<id>.json dumps of one feedback run
// (FEEDBACK_DUMP=1 npm run test:feedback). The bank grades the bar, not the
// move verdicts: every weight or K change reads this census next to the
// paired bank. The count alone is not the verdict (round 48: the total held
// at 38/2/0 -> 32/2/1 while the expert golden gained a blunder), so --moved
// names every turn behind a changed number.
//
// Reading rules the numbers carry with them:
// - A side-turn without a matched played action ("unmatched") can never get a
//   tier. It is counted, not divided away: a change that loses matches would
//   otherwise shrink the denominator and leave the rate flat.
// - Doubles grades are coarser than singles grades. The graded best comes
//   from a restricted set of pair choices, and where a slot's action never
//   showed (flinch, sleep) the regret is a charitable lower bound: "partial".
// - The game type comes from the replay fixture's |gametype| line and is
//   cross-checked against the dump's own doubles marks; a disagreement throws.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TIERS = ['inaccuracy', 'mistake', 'blunder'];
const DUMP_PREFIX = 'feedback-full-';
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e-feedback', 'fixtures');

/** getReplayGameType of @fulllifegames/replay-core, to the letter (regression/tier-census.spec.ts holds the two equal). */
export function gameTypeOfLog(log) {
  const raw = log?.match(/^\|gametype\|([^|\n]+)/m)?.[1];
  return raw ? raw.toLowerCase().replace(/[^a-z0-9]+/g, '') : null;
}

/** Doubles marks inside a dump: per-slot played actions, or a ranked pair choice ("move a 1, move b 2"). */
export function gameTypeFromDump(dump) {
  const sides = (dump.analyses ?? []).filter(Boolean).flatMap(analysis => [analysis.p1, analysis.p2]);
  const pair = option => typeof option?.choice === 'string' && option.choice.includes(', ');
  const doubles = sides.some(side => Array.isArray(side.playedSlots) || pair(side.best) || pair(side.played) || pair(side.safe));
  return doubles ? 'doubles' : 'singles';
}

/** The game type of one dump: the fixture log decides, the dump's own marks must agree. */
export function resolveGameType(id, dump, fixtures = FIXTURES) {
  const fromDump = gameTypeFromDump(dump);
  const fixture = join(fixtures, `${id}.json`);
  if (!existsSync(fixture)) return fromDump;
  const fromLog = gameTypeOfLog(JSON.parse(readFileSync(fixture, 'utf8')).log);
  if (fromLog !== null && fromLog !== fromDump) {
    throw new Error(`${id}: the fixture log says ${fromLog}, the dump reads ${fromDump}`);
  }
  return fromLog ?? fromDump;
}

const emptyCount = () => ({
  turns: 0, sides: 0, unmatched: 0, inaccuracy: 0, mistake: 0, blunder: 0, partial: 0, riskPaidOff: 0, attribution: {},
});

/** Counts of one dump. Tiers are read at analyses[i].p1/p2.tier only: nested tiers (sensitivity alternatives, report rows) are not verdicts. */
export function censusOfDump(dump) {
  const count = emptyCount();
  for (const analysis of dump.analyses ?? []) {
    if (!analysis) continue;
    count.turns += 1;
    count.attribution[analysis.attribution] = (count.attribution[analysis.attribution] ?? 0) + 1;
    for (const side of [analysis.p1, analysis.p2]) {
      count.sides += 1;
      if (!side.played) count.unmatched += 1;
      if (TIERS.includes(side.tier)) count[side.tier] += 1;
      if (side.playedPartial) count.partial += 1;
      if (side.riskPaidOff) count.riskPaidOff += 1;
    }
  }
  return count;
}

export function addCounts(into, count) {
  for (const key of Object.keys(count)) {
    if (key === 'attribution') continue;
    into[key] += count[key];
  }
  for (const [name, n] of Object.entries(count.attribution)) into.attribution[name] = (into.attribution[name] ?? 0) + n;
  return into;
}

const dumpIds = folder => readdirSync(folder)
  .filter(name => name.startsWith(DUMP_PREFIX) && name.endsWith('.json'))
  .map(name => name.slice(DUMP_PREFIX.length, -'.json'.length)).sort();
const readDump = (folder, id) => JSON.parse(readFileSync(join(folder, `${DUMP_PREFIX}${id}.json`), 'utf8'));

/** One folder: id -> { gameType, ...counts }. */
export function censusOfFolder(folder, fixtures = FIXTURES) {
  const games = new Map();
  for (const id of dumpIds(folder)) {
    const dump = readDump(folder, id);
    games.set(id, { gameType: resolveGameType(id, dump, fixtures), ...censusOfDump(dump) });
  }
  return games;
}

const tierCell = count => (count ? `${count.inaccuracy}/${count.mistake}/${count.blunder}` : '-');
const detailCell = count => (count ? `${tierCell(count)} (${count.sides} sides, ${count.unmatched} unmatched, ${count.partial} partial)` : '-');

/** The printed census of one or more folders; the replay list is the UNION over all folders. */
export function censusLines(folders, fixtures = FIXTURES) {
  const all = folders.map(folder => censusOfFolder(folder, fixtures));
  const ids = [...new Set(all.flatMap(games => [...games.keys()]))].sort();
  const typeOf = id => all.map(games => games.get(id)?.gameType).find(Boolean);
  const lines = [`tiers as inaccuracy/mistake/blunder per side-turn; columns: ${folders.join(' | ')}`];
  for (const gameType of ['singles', 'doubles']) {
    const inType = ids.filter(id => typeOf(id) === gameType);
    if (inType.length === 0) continue;
    lines.push(` ${gameType}:`);
    for (const id of inType) lines.push(`   ${id.padEnd(34)} ${all.map(games => tierCell(games.get(id)).padStart(9)).join(' | ')}`);
    const totals = all.map(games => inType.reduce((sum, id) => (games.has(id) ? addCounts(sum, games.get(id)) : sum), emptyCount()));
    lines.push(`   ${`TOTAL ${gameType} (${inType.length} replays)`.padEnd(34)} ${totals.map(total => detailCell(total)).join(' | ')}`);
    const names = [...new Set(totals.flatMap(total => Object.keys(total.attribution)))].sort();
    lines.push(`   ${'attribution per turn'.padEnd(34)} ${totals.map(total => names.map(name => `${name} ${total.attribution[name] ?? 0}`).join(', ')).join(' | ')}`);
  }
  const missing = ids.filter(id => all.some(games => !games.has(id)));
  if (missing.length > 0) lines.push(` not in every folder: ${missing.join(', ')}`);
  return lines;
}

const sideState = side => ({
  tier: TIERS.includes(side.tier) ? side.tier : '-',
  regret: typeof side.regret === 'number' ? side.regret : null,
  matched: Boolean(side.played),
  marks: [side.riskPaidOff ? 'riskPaidOff' : null, side.playedPartial ? 'partial' : null, side.sacrifice ? 'sacrifice' : null].filter(Boolean),
});
const verdictOf = analysis => `${analysis.attribution}|${sideState(analysis.p1).tier}|${sideState(analysis.p2).tier}`;
const matchOf = analysis => `${sideState(analysis.p1).matched}|${sideState(analysis.p2).matched}`;

/** Turns of one replay whose attribution, tier or played-match changed, joined on analysis.turn. */
export function movedTurns(baseDump, nextDump) {
  const byTurn = dump => new Map((dump.analyses ?? []).filter(Boolean).map(analysis => [analysis.turn, analysis]));
  const base = byTurn(baseDump);
  const next = byTurn(nextDump);
  const moved = [];
  for (const turn of [...new Set([...base.keys(), ...next.keys()])].sort((x, y) => x - y)) {
    const before = base.get(turn);
    const after = next.get(turn);
    if (!before || !after) {
      moved.push({ turn, before: before ? verdictOf(before) : 'absent', after: after ? verdictOf(after) : 'absent', sides: [] });
      continue;
    }
    if (verdictOf(before) === verdictOf(after) && matchOf(before) === matchOf(after)) continue;
    const sides = ['p1', 'p2'].map(side => ({ side, before: sideState(before[side]), after: sideState(after[side]) }))
      .filter(entry => entry.before.tier !== entry.after.tier || entry.before.matched !== entry.after.matched);
    moved.push({ turn, before: verdictOf(before), after: verdictOf(after), sides });
  }
  return moved;
}

const regretText = value => (value === null ? 'n/a' : value.toFixed(3));

/** The printed moved listing between two folders; replays present in only one folder are named, never skipped silently. */
export function movedLines(baseFolder, nextFolder, fixtures = FIXTURES) {
  const baseIds = dumpIds(baseFolder);
  const nextIds = dumpIds(nextFolder);
  const lines = [`turns whose attribution, tier or played-match moved: ${baseFolder} -> ${nextFolder}`];
  let total = 0;
  for (const id of baseIds.filter(name => nextIds.includes(name))) {
    const nextDump = readDump(nextFolder, id);
    const moved = movedTurns(readDump(baseFolder, id), nextDump);
    total += moved.length;
    if (moved.length === 0) continue;
    lines.push(` ${id} (${resolveGameType(id, nextDump, fixtures)}): ${moved.length} turns`);
    for (const entry of moved) {
      lines.push(`   t${entry.turn}: ${entry.before} -> ${entry.after}`);
      for (const side of entry.sides) {
        const marks = side.after.marks.length > 0 ? ` [${side.after.marks.join(', ')}]` : '';
        const match = side.before.matched === side.after.matched ? '' : `, played ${side.before.matched ? 'matched' : 'unmatched'} -> ${side.after.matched ? 'matched' : 'unmatched'}`;
        lines.push(`     ${side.side}: ${side.before.tier} -> ${side.after.tier}, regret ${regretText(side.before.regret)} -> ${regretText(side.after.regret)}${match}${marks}`);
      }
    }
  }
  lines.push(` moved turns in total: ${total}`);
  const onlyBase = baseIds.filter(name => !nextIds.includes(name));
  const onlyNext = nextIds.filter(name => !baseIds.includes(name));
  if (onlyBase.length > 0) lines.push(` only in the base folder: ${onlyBase.join(', ')}`);
  if (onlyNext.length > 0) lines.push(` only in the next folder: ${onlyNext.join(', ')}`);
  return lines;
}

function main(argv) {
  if (argv[0] === '--moved') {
    if (argv.length !== 3) throw new Error('usage: node scripts/tier-census.mjs --moved <base-folder> <next-folder>');
    return movedLines(argv[1], argv[2]);
  }
  if (argv.length === 0) throw new Error('usage: node scripts/tier-census.mjs <folder> [<folder>...] | --moved <base-folder> <next-folder>');
  return censusLines(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const line of main(process.argv.slice(2))) console.log(line);
}
