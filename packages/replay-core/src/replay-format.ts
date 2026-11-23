import { Battle } from '@pkmn/client';
import { Protocol } from '@pkmn/protocol';
import { isChampionsFormat } from './champions-format.ts';
import { CHAMPIONS_MOD } from './calc-gen.ts';
import { generationsFor } from './format-generations.ts';
import type { ReplayData, TurnSnapshot } from './types.ts';
import type { SmogonUsageStats } from './smogon/stats-types.ts';
import { toId } from './ids.ts';
import { dexOf, simFormats, type GameRules } from './rules-dex.ts';
import { normalizeLineEndings } from './line-endings.ts';

type ReplayFormatSource = Partial<Pick<ReplayData, 'id' | 'format' | 'formatid' | 'log'>>;

const optionalId = (value: string | undefined): string => toId(value ?? '');

/** The log as LF lines: the readers below match line by line, whatever endings the file came with. */
const lfLog = (log: string | undefined): string | undefined => (log === undefined ? undefined : normalizeLineEndings(log));

/** Splits Showdown's `-{password}pw` suffix off a private replay id; the suffix belongs in the fetched id, never in anything derived from it. */
export function splitReplayPassword(fullid: string): [id: string, password: string | null] {
  if (fullid.endsWith('pw')) {
    const dash = fullid.lastIndexOf('-');
    // A 31-character password read as part of the format gave `gen9natdexdraft2632003305e10u...pw`, which no Dex knows: the replay fell back
    // to a rule-less custom game.
    if (dash > 0) return [fullid.slice(0, dash), fullid.slice(dash + 1, -2)];
  }
  return [fullid, null];
}

function stripReplayNumber(id: string | undefined): string {
  return splitReplayPassword(id || '')[0].replace(/-\d+$/, '');
}

/**
 * The header facts of a log (game type, generation, tier, the number brought at team preview) as @pkmn/client's Battle holds them after it
 * has read the header lines, so the library's handlers decide what a line means (the last `|gametype|` wins, `|teampreview|` without a
 * number is six). The header is the text before `|start`; only the four lines the facts come from go to the client. A header reads once
 * per distinct text, because the hooks ask for these facts on every render.
 */
interface ReplayHeader {
  /** The raw `|gametype|` argument, or null when the log has no such line (the client's default "singles" says nothing). */
  gameType: string | null;
  gen: number | null;
  tier: string;
  /** The client's `teamPreviewCount` after the header, or null without a `|teampreview|` line. */
  teamPreviewCount: number | null;
}

const HEADER_LINES = ['|gametype|', '|gen|', '|tier|', '|teampreview'];
const HEADER_CACHE_LIMIT = 32;
const headerCache = new Map<string, ReplayHeader>();

function readHeaderText(text: string): ReplayHeader {
  const battle = new Battle(generationsFor(''));
  let gameType = false;
  let gen = false;
  let preview = false;
  for (const line of text.split('\n')) {
    if (!HEADER_LINES.some((prefix) => line.startsWith(prefix))) continue;
    const { args, kwArgs } = Protocol.parseBattleLine(line);
    const key = Protocol.key(args);
    if (key === '|teampreview|') preview = true;
    else if (key === '|gametype|') gameType = true;
    else if (key === '|gen|') gen = true;
    else if (key !== '|tier|') continue;
    try {
      battle.add(args, kwArgs);
    } catch {
      // A generation the client does not know: the line says nothing.
      if (key === '|gen|') gen = false;
    }
  }
  const { num: generation } = battle.gen;
  return { gameType: gameType ? battle.gameType : null, gen: gen ? generation : null, tier: battle.tier, teamPreviewCount: preview ? battle.teamPreviewCount : null };
}

function readHeader(log: string | undefined): ReplayHeader {
  const lf = lfLog(log) ?? '';
  const start = /^\|start(?:\||$)/m.exec(lf);
  const text = start ? lf.slice(0, start.index) : lf;
  let header = headerCache.get(text);
  if (!header) {
    header = readHeaderText(text);
    if (headerCache.size >= HEADER_CACHE_LIMIT) headerCache.delete(headerCache.keys().next().value as string);
    headerCache.set(text, header);
  }
  return header;
}

const extractTier = (log: string | undefined): string => readHeader(log).tier;

function extractGen(source: ReplayFormatSource & { formatid?: string }): string {
  const fromFormatId = source.formatid?.match(/^gen(\d+)/)?.[1];
  if (fromFormatId) return fromFormatId;

  const fromLog = readHeader(source.log).gen;
  if (fromLog) return String(fromLog);

  const fromFormat = optionalId(source.format || extractTier(source.log)).match(/gen(\d+)/)?.[1];
  if (fromFormat) return fromFormat;

  return '9';
}

/** How many bodies each side has, from the last `|teamsize|` line of the side (a brought count after a team preview); null for a side the log does not size. */
export function teamSizes(log: string | readonly string[]): { p1: number | null; p2: number | null } {
  const sizes: { p1: number | null; p2: number | null } = { p1: null, p2: null };
  const lines = typeof log === 'string' ? (lfLog(log) ?? '').split('\n') : log;
  for (const line of lines) {
    const match = /^\|teamsize\|(p[12])\|(\d+)/.exec(line);
    if (match) sizes[match[1] as 'p1' | 'p2'] = Number(match[2]);
  }
  return sizes;
}

/** The id of the log's `|gametype|` line (singles, doubles), null without one. */
export function getReplayGameType(log: string | undefined): string | null {
  const raw = lfLog(log)?.match(/^\|gametype\|([^|\n]+)/m)?.[1];
  return raw ? optionalId(raw) : null;
}

/**
 * Smogtours replay ids prefix the real format (`smogtours-gen3ou-56583`) and sometimes drop the gen (`smogtours-ubers`): stripping the
 * prefix and re-adding the generation gives the format the usage stats and the branch simulator understand.
 */
function normalizeInferredFormatId(id: string, source: ReplayFormatSource): string {
  let normalized = id.replace(/^smogtours/, '');
  if (normalized && !/^gen\d/.test(normalized)) {
    normalized = `gen${extractGen(source)}${normalized}`;
  }
  return normalized || id;
}

/** The format id of a replay: the explicit one, else the one in its id, its log's tier or its format name, else the generation's OU. */
export function inferReplayFormatId(source: ReplayFormatSource): string {
  const explicit = optionalId(source.formatid);
  if (explicit) return normalizeInferredFormatId(explicit, source);

  const fromReplayId = optionalId(stripReplayNumber(source.id));
  if (fromReplayId) return normalizeInferredFormatId(fromReplayId, source);

  const fromTier = optionalId(extractTier(source.log));
  if (fromTier) return normalizeInferredFormatId(fromTier, source);

  const fromFormat = optionalId(source.format);
  if (fromFormat) return normalizeInferredFormatId(fromFormat, source);

  return `gen${extractGen(source)}ou`;
}

/** Prefixes the generation when the display format omits it ("Ubers" → "[Gen 6] Ubers"). */
export function getReplayDisplayFormat(source: ReplayFormatSource, formatid: string): string {
  const format = (source.format || '').trim();
  if (!format) return formatid;
  if (/gen\s*\d/i.test(format)) return format;
  const gen = getReplayGeneration({ ...source, formatid });
  return `[Gen ${gen}] ${format}`;
}

/** The generation of a replay, 9 when nothing names one. */
export function getReplayGeneration(source: ReplayFormatSource): number {
  const formatid = inferReplayFormatId(source);
  return parseInt(extractGen({ ...source, formatid }), 10) || 9;
}

/** The generation and mod a replay plays by: the Dex of the game is `dexOf` of these. */
export function replayRules(source: ReplayFormatSource): GameRules {
  return { gen: getReplayGeneration(source), mod: replayRuleset(source) === 'champions' ? CHAMPIONS_MOD : undefined };
}

/** Whether a side has two non-Rest sleepers at once: a log the Sleep Clause cannot describe. */
function logShowsSecondSleep(log: string): boolean {
  const sleepers: Record<'p1' | 'p2', Set<string>> = { p1: new Set(), p2: new Set() };
  let lastMoveWasRest = false;
  for (const line of log.split('\n')) {
    if (line.startsWith('|move|')) {
      lastMoveWasRest = optionalId(line.split('|')[3]) === 'rest';
      continue;
    }
    const status = line.match(/^\|-status\|(p[12])[a-d]?: ([^|\n]+)\|slp/);
    if (status) {
      if (lastMoveWasRest || line.includes('[from] move: Rest')) continue;
      const side = status[1] as 'p1' | 'p2';
      if (sleepers[side].size > 0) return true;
      sleepers[side].add(status[2].trim());
      continue;
    }
    const cure = line.match(/^\|-curestatus\|(p[12])[a-d]?: ([^|\n]+)\|slp/);
    if (cure) sleepers[cure[1] as 'p1' | 'p2'].delete(cure[2].trim());
    const faint = line.match(/^\|faint\|(p[12])[a-d]?: ([^|\n]+)/);
    if (faint) sleepers[faint[1] as 'p1' | 'p2'].delete(faint[2].trim());
  }
  return false;
}

/**
 * Sleep Clause for the singles branch sim, custom-game bases only: a real ladder format is its own rule authority (gen3ou carries the
 * clause, gen9ou bans sleep moves). The replay's |rule| lines decide; a log with no rule lines at all (video-reconstructed) gets the
 * singles-standard default unless it shows a second simultaneous sleep.
 */
function sleepClauseSuffix(rawLog: string | undefined, base: string): string {
  const log = lfLog(rawLog);
  if (!log || !base.endsWith('customgame')) return '';
  if (/^\|rule\|Sleep Clause/m.test(log)) return '@@@Sleep Clause Mod';
  // Only real rule declarations ("Name: description") count: video pipelines watermark their logs with colon-less |rule| lines
  // ("Reconstructed from video by gpl-pipeline - best effort"), which must not silence the singles default.
  if (/^\|rule\|[^|\n]*: /m.test(log)) return '';
  if (logShowsSecondSleep(log)) return '';
  return '@@@Sleep Clause Mod';
}

/**
 * Terastal Clause for the branch sim: it nulls every canTerastallize at battle start, so a draft game that declared it must not offer
 * Tera in the branch. Read like Sleep Clause: the `|rule|` line decides, a real format is its own authority.
 */
const teraClause = (rawLog: string | undefined): string => (/^\|rule\|Terastal Clause/m.test(lfLog(rawLog) ?? '') ? 'Terastal Clause' : '');

const joinRules = (...rules: string[]): string => (rules.some(Boolean) ? `@@@${rules.filter(Boolean).join(',')}` : '');

/** How many Pokémon each side brings at team preview (VGC: 4 of 6, Battle Stadium Singles: 3), null for formats that bring the full team. */
export function getReplayBringCount(source: ReplayFormatSource): number | null {
  const formatid = inferReplayFormatId(source);
  if (!formatid) return null;
  const format = simFormats().get(formatid);
  if (format.exists) {
    try {
      const size = simFormats().getRuleTable(format).pickedTeamSize;
      if (typeof size === 'number' && size > 0) return size;
      return null;
    } catch {
      // Rule table refused (mod gaps) — fall through to the log.
    }
  }
  // The log's `|teampreview|N` is a bring limit when 1 to 5 (a bare `|teampreview` is six and says nothing); it covers VGC regulations that
  // postdate the bundled sim.
  const previewed = readHeader(source.log).teamPreviewCount;
  if (previewed !== null && previewed >= 1 && previewed <= 5) return previewed;
  // No such line: every VGC ruleset to date brings 4.
  if (formatid.includes('vgc') || formatid.includes('battlestadiumdoubles')) return 4;
  if (formatid.includes('battlestadiumsingles')) return 3;
  return null;
}

// The protocol reveals active formes (Zamazenta-Crowned, Terapagos-Stellar) while team preview and the built sets may carry the base name
// or the "-*" unknown-forme marker.
/** The base-species id for bring matching. */
export function speciesBaseId(name: string, rules: GameRules): string {
  const species = dexOf(rules).species.get(name);
  return optionalId(species.exists ? species.baseSpecies || species.name : name);
}

/** The species each side fielded, in first-appearance order: one entry per body, so a forme change in battle (Terapagos-Terastal to -Stellar) keeps its first-seen name. */
export function broughtSpeciesFor(snapshots: TurnSnapshot[], side: 'p1' | 'p2', rules: GameRules): string[] {
  const seenBases = new Set<string>();
  const ordered: string[] = [];
  const add = (own: string) => {
    const base = speciesBaseId(own, rules);
    if (seenBases.has(base)) return;
    seenBases.add(base);
    ordered.push(own);
  };
  for (const turn of snapshots) {
    for (const pokemon of turn[side].pokemon) {
      if (!pokemon.isActive) continue;
      // A body that wears a Transform copy (Imposter, the move) lists the species it entered with, never the copy.
      add(pokemon.baseSpeciesForme ?? pokemon.speciesForme);
    }
    // A snapshot shows the bodies on the field at the turn's end, so a body that entered and fainted or left within the turn is in the
    // turn's log lines only.
    for (const name of enteredInLog(turn.log, side)) add(name);
  }
  return ordered;
}

/**
 * The species each protocol line of one turn brings onto the field for a side, in line order: `switch` (a player's switch, a U-turn or
 * Volt Switch with `[from]`, the forced replacement after a faint) and `drag` (Roar, Whirlwind, Dragon Tail, Red Card). `replace` (an
 * Illusion that breaks) names the real body, and the `switch` line it replaces named only the disguise, a party member that may never have
 * fielded, so the replace drops that entry. The species is the first word of the details field, the one the body entered with.
 */
function enteredInLog(lines: readonly string[] | undefined, side: 'p1' | 'p2'): string[] {
  const entries: { slot: string; species: string }[] = [];
  for (const line of lines ?? []) {
    const match = /^\|(switch|drag|replace)\|(p[1-4][a-d]): [^|]*\|([^|,]+)/.exec(line);
    if (!match || !match[2].startsWith(side)) continue;
    if (match[1] === 'replace') {
      const disguised = entries.map(entry => entry.slot).lastIndexOf(match[2]);
      if (disguised >= 0) entries.splice(disguised, 1);
    }
    entries.push({ slot: match[2], species: match[3] });
  }
  return entries.map(entry => entry.species);
}

/** The bring lists of a bring-limited replay, both sides or neither: null for bring-all formats and when either side's selection is not pinned (short games). */
export function replayBringOnly(
  source: ReplayFormatSource,
  snapshots: TurnSnapshot[],
): { p1: string[]; p2: string[] } | null {
  const bringCount = getReplayBringCount(source);
  if (bringCount === null) return null;
  const rules = replayRules(source);
  const p1 = broughtSpeciesFor(snapshots, 'p1', rules);
  const p2 = broughtSpeciesFor(snapshots, 'p2', rules);
  // A pinned four against an unpinned six overrates the open side (a won game flipped to the loser): symmetric-wrong beats asymmetric-wrong.
  return p1.length === bringCount && p2.length === bringCount ? { p1, p2 } : null;
}

/** One side of a bring list. */
export interface BringSide {
  fielded: string[];
  /**
   * The preview bodies the side never fielded, in preview order, each with its share of the side's open choice (the shares sum to 1; empty
   * when `open` is 0).
   */
  candidates: { species: string; weight: number }[];
  /** How many of the side's brought bodies never entered (the count minus `fielded`). */
  open: number;
}

/** The bring lists of a bring-limited game with the unknown bodies a short side still holds. */
export interface BringList {
  count: number;
  p1: BringSide;
  p2: BringSide;
}

/**
 * The usage count of each base species: the sum of `rawCount` over the stats entries that share the base (Urshifu-Rapid-Strike and
 * Urshifu-Single-Strike are one Urshifu).
 */
function usageCountsByBase(stats: SmogonUsageStats | null | undefined, rules: GameRules): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of Object.values(stats?.pokemon ?? {})) {
    if (!(entry.rawCount > 0)) continue;
    const base = speciesBaseId(entry.species, rules);
    counts.set(base, (counts.get(base) ?? 0) + entry.rawCount);
  }
  return counts;
}

/** The bring list of a bring-limited replay with the bodies a side brought but never fielded; null for bring-all formats or when the preview cannot name enough candidates. */
export function replayBringList(
  source: ReplayFormatSource,
  snapshots: TurnSnapshot[],
  stats?: SmogonUsageStats | null,
): BringList | null {
  const count = getReplayBringCount(source);
  if (count === null) return null;
  const rules = replayRules(source);
  const byBase = usageCountsByBase(stats, rules);
  const smallest = byBase.size > 0 ? Math.min(...byBase.values()) : 0;
  const sideOf = (side: 'p1' | 'p2'): BringSide | null => {
    const fielded = broughtSpeciesFor(snapshots, side, rules);
    const open = count - fielded.length;
    if (open < 0) return null;
    if (open === 0) return { fielded, candidates: [], open };
    const have = new Set(fielded.map(name => speciesBaseId(name, rules)));
    const seen = new Set<string>();
    const previewed: string[] = [];
    for (const pokemon of snapshots[0]?.[side].pokemon ?? []) {
      const base = speciesBaseId(pokemon.baseSpeciesForme ?? pokemon.speciesForme, rules);
      if (have.has(base) || seen.has(base)) continue;
      seen.add(base);
      previewed.push(pokemon.baseSpeciesForme ?? pokemon.speciesForme);
    }
    if (previewed.length < open) return null;
    // A candidate weighs by the usage count of its base species; one the stats lack takes the smallest count present (the stats list every
    // species above their cutoff, so a missing one is rarer); without any count the weights are equal.
    const raw = previewed.map(species => byBase.get(speciesBaseId(species, rules)) ?? smallest);
    const total = raw.reduce((sum, value) => sum + value, 0);
    const candidates = previewed.map((species, index) => ({ species, weight: total > 0 ? raw[index] / total : 1 / previewed.length }));
    return { fielded, candidates, open };
  };
  const p1 = sideOf('p1');
  const p2 = sideOf('p2');
  return p1 && p2 ? { count, p1, p2 } : null;
}

/** The rule set a replay's static weighs by (the engine's StaticRuleset). */
export type ReplayRuleset = 'standard' | 'vgc' | 'champions';

/** The rule set of a replay from its format id: Champions is its own game on the Champions mod, VGC outside Champions (bring six, pick four, level 50) parts from Doubles OU. */
export function replayRuleset(source: ReplayFormatSource): ReplayRuleset {
  const format = inferReplayFormatId(source);
  if (isChampionsFormat(format)) return 'champions';
  return /vgc/.test(format) ? 'vgc' : 'standard';
}

/** Whether the branch format enforces Sleep Clause, by a custom-rule suffix or by its own rule table. */
export function formatEnforcesSleepClause(format: string): boolean {
  if (/@@@.*sleep ?clause/i.test(format)) return true;
  const base = simFormats().get(format.split('@@@')[0]);
  try {
    return base.exists && simFormats().getRuleTable(base).has('sleepclausemod');
  } catch {
    return false;
  }
}

/**
 * The Champions mod's formats (@pkmn/mods champions) a Champions replay branches on. Singles play the mod's OU; doubles play its Doubles
 * Custom Game, which brings the whole team as Doubles OU does (the reconstruction trims to the brought Pokémon itself, where a VGC format's
 * team preview would keep the first four). The regulation changes only legality, and the base Dex resolves no custom-rule suffix on a mod format.
 */
const CHAMPIONS_SINGLES_FORMAT = 'gen9championsou';
const CHAMPIONS_DOUBLES_FORMAT = 'gen9championsdoublescustomgame';

/** The simulator format a replay's branch plays on; a custom game carries the Sleep and Terastal clauses as a custom-rule suffix. */
export function getBranchSimulatorFormat(source: ReplayFormatSource): string {
  const formatid = inferReplayFormatId(source);
  const gameType = getReplayGameType(source.log);
  const gen = extractGen({ ...source, formatid });
  const doubles = gameType === 'doubles' || formatid.includes('doubles') || formatid.includes('vgc');

  if (replayRuleset(source) === 'champions') return doubles ? CHAMPIONS_DOUBLES_FORMAT : CHAMPIONS_SINGLES_FORMAT;
  if (doubles) return `gen${gen}doublesou${joinRules(teraClause(source.log))}`;

  // A formatid the sim does not know (draft leagues, video pipelines) runs as a rule-less custom game: name that explicitly so clause
  // suffixes have a real base to attach to.
  const known = formatid && simFormats().get(formatid).exists ? formatid : '';
  const base = known || (formatid ? `gen${gen}customgame` : `gen${gen}ou`);
  return `${base}${joinRules(sleepClauseSuffix(source.log, base).slice(3), base.endsWith('customgame') ? teraClause(source.log) : '')}`;
}
