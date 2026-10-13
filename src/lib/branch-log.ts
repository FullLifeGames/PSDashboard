/**
 * The protocol log the replay iframe plays for a branch: the replay's own lines
 * through the branch turn, then the simulator's lines for every executed turn.
 *
 * The embed finds a Pokémon again by its ident and its details string, and the
 * two halves of the log spell both differently. The replay says
 * `|switch|p1a: NOT ICT|Landorus-Therian, M, shiny|` (the player's nickname, the
 * game's own flags); the simulator says `|switch|p1a: Landorus|Landorus-Therian, M|`
 * (the name of the set the team builder made, the flags of that set). A
 * simulator switch-in met no roster entry and became a second one: the second
 * entry fainted, while the sidebar (one icon per species, the first entry wins)
 * kept showing the first one alive. The frame therefore gets the simulator's
 * lines in the replay's names and with the replay's flags.
 */
import { speciesBaseId } from '@fulllifegames/replay-core';

interface BranchBody {
  name: string;
  species: string;
}

/** The simulator's bodies of both sides (BranchSimState.p1Pokemon and p2Pokemon). */
export interface BranchBodies {
  p1: readonly BranchBody[];
  p2: readonly BranchBody[];
}

type Side = 'p1' | 'p2';
const SIDES: readonly Side[] = ['p1', 'p2'];

/** Lines the embed must not show: spectator splits, chat, and the simulator's debug output (G13). */
const HIDDEN_FROM_FRAME = ['|split|', '|c|', '|debug|'];

/** A body entering the field: the ident is the first field, the details the second. */
const ENTRY_LINE = /^\|(?:switch|drag|replace)\|(p[12])[a-d]?: ([^|]*)\|([^|]*)/;

/** Team preview: the side and the details of one of its bodies. */
const PREVIEW_LINE = /^\|poke\|(p[12])\|([^|]*)/;

/** The lines that carry a body's details in their second field. */
const DETAILS_COMMANDS = new Set(['switch', 'drag', 'replace', 'detailschange']);

/** The details flags that stay with a body for the whole battle (the others, tera:<type>, come and go). */
const STATIC_FLAG = /^(L\d+|M|F|shiny)$/;

/** A field that is one Pokémon's ident, plain (`p1a: Name`, `p1: Name` off the field) or as a kwarg (`[of] p2a: Name`). */
const IDENT_FIELD = /^(\[of\] )?(p[12])([a-d]?): (.+)$/;

/** The side-condition lines name the player (`p1: FullLifeGames`), not a body. */
const SIDE_COMMANDS = new Set(['-sidestart', '-sideend', '-sideactivate']);

/** Wish names its healer without an ident: `[wisher] Name`, a body of the healed one's side. */
const WISHER = '[wisher] ';

/** Per base species: the static flags the replay shows for it, null when its bodies disagree. */
type FlagsBySpecies = Map<string, string[] | null>;

interface ReplayNames {
  /** The replay's own lines: they already speak its names. */
  lines: ReadonlySet<string>;
  /** Per side, the nicknames the replay gave each base species, in first-seen order. */
  nicknames: Record<Side, Map<string, string[]>>;
  /** Per side, the level, gender and shiny flags the replay's lines show for each base species. */
  flags: Record<Side, FlagsBySpecies>;
}

function noteFlags(flagsBySpecies: FlagsBySpecies, details: string): void {
  const [species, ...flags] = details.split(', ');
  // Team preview hides an unrevealed forme as `Species-*`.
  const base = speciesBaseId(species.trim().replace(/-\*$/, ''));
  const statics = flags.filter(flag => STATIC_FLAG.test(flag));
  const known = flagsBySpecies.get(base);
  if (known === undefined) flagsBySpecies.set(base, statics);
  else if (known !== null && known.join() !== statics.join()) flagsBySpecies.set(base, null);
}

function readReplayNames(replayLog: string): ReplayNames {
  const lines = new Set<string>();
  const nicknames: ReplayNames['nicknames'] = { p1: new Map(), p2: new Map() };
  const previewed = { p1: new Map() as FlagsBySpecies, p2: new Map() as FlagsBySpecies };
  const revealed = { p1: new Map() as FlagsBySpecies, p2: new Map() as FlagsBySpecies };
  for (const raw of replayLog.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    lines.add(line);
    const preview = PREVIEW_LINE.exec(line);
    if (preview) {
      noteFlags(previewed[preview[1] as Side], preview[2]);
      continue;
    }
    const entry = ENTRY_LINE.exec(line);
    if (!entry) continue;
    const side = entry[1] as Side;
    noteFlags(revealed[side], entry[3]);
    const bySpecies = nicknames[side];
    const base = speciesBaseId(entry[3].split(', ')[0].trim());
    const known = bySpecies.get(base);
    if (!known) bySpecies.set(base, [entry[2]]);
    else if (!known.includes(entry[2])) known.push(entry[2]);
  }
  // A body the game switched in shows its flags there; one it never showed keeps its team preview's.
  const flags: ReplayNames['flags'] = { p1: new Map([...previewed.p1, ...revealed.p1]), p2: new Map([...previewed.p2, ...revealed.p2]) };
  return { lines, nicknames, flags };
}

/**
 * The replay's nickname for one simulator body, found through its species: the
 * set's name is the base species (or the user's pasted nickname), so the name
 * speaks first and the current species second (a Transform changes only that).
 * Null when the replay never named the species or named two bodies of it.
 */
function nicknameOf(bySpecies: ReadonlyMap<string, string[]>, body: BranchBody): string | null {
  for (const base of [speciesBaseId(body.name), speciesBaseId(body.species)]) {
    const nicknames = bySpecies.get(base);
    if (nicknames) return nicknames.length === 1 ? nicknames[0] : null;
  }
  return null;
}

/**
 * `p1: <simulator name>` -> the replay's nickname. A name two bodies share, or a
 * nickname two bodies resolve to, stays out: the line cannot say which one it
 * means, and the frame then keeps the simulator's name as before.
 */
function renameTable(names: ReplayNames, bodies: BranchBodies): Map<string, string> {
  const table = new Map<string, string>();
  for (const side of SIDES) {
    const bodiesNamed = new Map<string, number>();
    const bodiesResolving = new Map<string, number>();
    const resolved: { name: string; nickname: string }[] = [];
    for (const body of bodies[side]) {
      bodiesNamed.set(body.name, (bodiesNamed.get(body.name) ?? 0) + 1);
      const nickname = nicknameOf(names.nicknames[side], body);
      if (nickname === null) continue;
      bodiesResolving.set(nickname, (bodiesResolving.get(nickname) ?? 0) + 1);
      resolved.push({ name: body.name, nickname });
    }
    for (const { name, nickname } of resolved) {
      if (name === nickname || bodiesNamed.get(name) !== 1 || bodiesResolving.get(nickname) !== 1) continue;
      table.set(`${side}: ${name}`, nickname);
    }
  }
  return table;
}

/** The details with the replay's level, gender and shiny flags in place of the simulator's (the species and tera:<type> stay). */
function detailsWithReplayFlags(details: string, side: Side, names: ReplayNames): string {
  const [species, ...flags] = details.split(', ');
  const wanted = names.flags[side].get(speciesBaseId(species.trim()));
  if (!wanted) return details;
  return [species, ...wanted, ...flags.filter(flag => !STATIC_FLAG.test(flag))].join(', ');
}

/** The side of the first body ident in the fields after the command, null when the line names none. */
function sideOfFirstIdent(fields: readonly string[]): Side | null {
  for (let index = 2; index < fields.length; index++) {
    const ident = IDENT_FIELD.exec(fields[index]);
    if (ident) return ident[2] as Side;
  }
  return null;
}

/** One field with its body ident, or the Wish healer's bare name, in the replay's names; null when it stays as it is. */
function renamedField(field: string, side: Side | null, table: ReadonlyMap<string, string>): string | null {
  const ident = IDENT_FIELD.exec(field);
  if (ident) {
    const nickname = table.get(`${ident[2]}: ${ident[4]}`);
    return nickname === undefined ? null : `${ident[1] ?? ''}${ident[2]}${ident[3]}: ${nickname}`;
  }
  if (!side || !field.startsWith(WISHER)) return null;
  const nickname = table.get(`${side}: ${field.slice(WISHER.length)}`);
  return nickname === undefined ? null : `${WISHER}${nickname}`;
}

/** The line with every body ident in the replay's names and, on a line that carries them, a body's details in its flags. */
function renameLine(line: string, names: ReplayNames, table: ReadonlyMap<string, string>): string {
  if (!line.includes(': ')) return line;
  const fields = line.split('|');
  if (SIDE_COMMANDS.has(fields[1])) return line;
  const side = sideOfFirstIdent(fields);
  let changed = false;
  for (let index = 2; index < fields.length; index++) {
    const renamed = renamedField(fields[index], side, table);
    if (renamed === null) continue;
    fields[index] = renamed;
    changed = true;
  }
  if (side && DETAILS_COMMANDS.has(fields[1]) && fields.length > 3) {
    const details = detailsWithReplayFlags(fields[3], side, names);
    if (details !== fields[3]) {
      fields[3] = details;
      changed = true;
    }
  }
  return changed ? fields.join('|') : line;
}

/**
 * The log string the iframe plays: the branch's lines without what the embed must
 * not show, every line the replay does not contain in the replay's names and flags
 * (a line the replay has already says it right).
 */
export function branchFrameLog(simLog: readonly string[], replayLog: string, bodies: BranchBodies): string {
  const names = readReplayNames(replayLog);
  const table = renameTable(names, bodies);
  return simLog
    .filter(line => line && !HIDDEN_FROM_FRAME.some(prefix => line.startsWith(prefix)))
    .map(line => (names.lines.has(line) ? line : renameLine(line, names, table)))
    .join('\n');
}
