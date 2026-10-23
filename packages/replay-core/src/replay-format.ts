import { Battle } from '@pkmn/client';
import { Protocol } from '@pkmn/protocol';
import { isChampionsFormat } from './champions-format.ts';
import { CHAMPIONS_MOD } from './calc-gen.ts';
import { generationsFor } from './format-generations.ts';
import type { ReplayData, TurnSnapshot } from './types.ts';
import { toId } from './ids.ts';
import { dexOf, simFormats, type GameRules } from './rules-dex.ts';
import { normalizeLineEndings } from './line-endings.ts';

type ReplayFormatSource = Partial<Pick<ReplayData, 'id' | 'format' | 'formatid' | 'log'>>;

/** Optional-input wrapper: an absent field normalizes to the empty id. */
const optionalId = (value: string | undefined): string => toId(value ?? '');

/** The log as LF lines: the readers below match line by line, whatever endings the file came with (round 70, T206). */
const lfLog = (log: string | undefined): string | undefined => (log === undefined ? undefined : normalizeLineEndings(log));

/**
 * Splits Showdown's `-{password}pw` suffix off a private replay id
 * (`gen9natdexdraft-2632003305-e10u50b7xrkmn0w7j5q2bac68relhlwpw`), mirroring
 * the replay server's own splitPasswordSuffix. The suffix belongs in the
 * FETCHED id — the replay API parses it there — but never in anything derived
 * from the id: a 31-character password read as part of the format produced
 * `gen9natdexdraft2632003305e10u...pw`, which no Dex knows, so every private
 * replay silently fell back to a rule-less custom game.
 */
export function splitReplayPassword(fullid: string): [id: string, password: string | null] {
  if (fullid.endsWith('pw')) {
    const dash = fullid.lastIndexOf('-');
    if (dash > 0) return [fullid.slice(0, dash), fullid.slice(dash + 1, -2)];
  }
  return [fullid, null];
}

function stripReplayNumber(id: string | undefined): string {
  return splitReplayPassword(id || '')[0].replace(/-\d+$/, '');
}

/**
 * Round 72 (T241): the header facts of a log (game type, generation, tier, the number brought at team preview) are what
 * @pkmn/client's Battle holds after it has read the header lines, so the library's handlers decide what a line means
 * (the last `|gametype|` wins, `|teampreview|` without a number is six). The header is the text before `|start`; a log
 * without a `|start` line is read whole. Only the four lines the facts come from go to the client. A header reads once
 * per distinct text, because the hooks ask for these facts on every render.
 */
interface ReplayHeader {
  /** The raw `|gametype|` argument, or null when the log has no such line (the client's default "singles" says nothing). */
  gameType: string | null;
  /** The `|gen|` line's generation, or null without one. */
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

export function getReplayGameType(log: string | undefined): string | null {
  const raw = lfLog(log)?.match(/^\|gametype\|([^|\n]+)/m)?.[1];
  return raw ? optionalId(raw) : null;
}

/**
 * Smogtours replay ids prefix the real format (`smogtours-gen3ou-56583`) and
 * sometimes drop the gen entirely (`smogtours-ubers`) — stripping the prefix
 * and re-adding the generation yields the format usage stats and the branch
 * simulator actually understand (B13).
 */
function normalizeInferredFormatId(id: string, source: ReplayFormatSource): string {
  let normalized = id.replace(/^smogtours/, '');
  if (normalized && !/^gen\d/.test(normalized)) {
    normalized = `gen${extractGen(source)}${normalized}`;
  }
  return normalized || id;
}

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

/** Prefixes the generation when the display format omits it ("Ubers" → "[Gen 6] Ubers", G5). */
export function getReplayDisplayFormat(source: ReplayFormatSource, formatid: string): string {
  const format = (source.format || '').trim();
  if (!format) return formatid;
  if (/gen\s*\d/i.test(format)) return format;
  const gen = getReplayGeneration({ ...source, formatid });
  return `[Gen ${gen}] ${format}`;
}

export function getReplayGeneration(source: ReplayFormatSource): number {
  const formatid = inferReplayFormatId(source);
  return parseInt(extractGen({ ...source, formatid }), 10) || 9;
}

/** The generation and mod a replay plays by: the Dex of the game is `dexOf` of these (round 75, T160). */
export function replayRules(source: ReplayFormatSource): GameRules {
  return { gen: getReplayGeneration(source), mod: replayRuleset(source) === 'champions' ? CHAMPIONS_MOD : undefined };
}

/** Sides' currently-sleeping (non-Rest) victims — detects logs the clause cannot describe. */
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
 * Sleep Clause for the singles branch sim — CUSTOM-GAME bases only: a real
 * ladder format is its own rule authority (gen3ou carries the clause; gen9ou
 * bans sleep moves outright instead). The replay's |rule| lines decide; a
 * log with NO rule lines at all (video-reconstructed pipelines) gets the
 * singles-standard default unless the log itself shows a second
 * simultaneous sleep.
 */
function sleepClauseSuffix(rawLog: string | undefined, base: string): string {
  const log = lfLog(rawLog);
  if (!log || !base.endsWith('customgame')) return '';
  if (/^\|rule\|Sleep Clause/m.test(log)) return '@@@Sleep Clause Mod';
  // Only REAL rule declarations ("Name: description") count as a declared
  // ruleset — video pipelines watermark their logs with colon-less |rule|
  // lines ("Reconstructed from video by gpl-pipeline - best effort"), and
  // treating those as "rules declared, clause absent" silenced the singles
  // default exactly where it was needed (GPL T11).
  if (/^\|rule\|[^|\n]*: /m.test(log)) return '';
  if (logShowsSecondSleep(log)) return '';
  return '@@@Sleep Clause Mod';
}

/**
 * How many Pokémon each side BRINGS at team preview (VGC: 4 of 6, Battle
 * Stadium Singles: 3 of 6), or null for formats that bring the full team.
 * The Dex's own rule table answers for formats it knows. For the rest the
 * log answers: its `|teampreview|N` line is the client's `teamPreviewCount`,
 * and 1 to 5 is a bring limit (a bare `|teampreview` is six and says nothing;
 * T241: over 5,648 replays of fixtures and fit
 * corpus the log and the rule table agree wherever the Dex knows the format,
 * and the log covers the 2,326 VGC replays whose regulation postdates the
 * bundled sim). Last comes the format-id heuristic for a log with no such
 * line (every VGC ruleset to date brings 4).
 */
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
  const previewed = readHeader(source.log).teamPreviewCount;
  if (previewed !== null && previewed >= 1 && previewed <= 5) return previewed;
  if (formatid.includes('vgc') || formatid.includes('battlestadiumdoubles')) return 4;
  if (formatid.includes('battlestadiumsingles')) return 3;
  return null;
}

/**
 * Base-species identity for bring matching: the protocol reveals ACTIVE
 * formes (Zamazenta-Crowned, Terapagos-Stellar) while team preview and the
 * built sets may carry the base name or the "-*" unknown-forme marker.
 * Species clause keeps one base per side in bring-limited formats, so the
 * base id is a safe secondary key there.
 */
export function speciesBaseId(name: string, rules: GameRules): string {
  const species = dexOf(rules).species.get(name);
  return optionalId(species.exists ? species.baseSpecies || species.name : name);
}

/**
 * The species each side actually fielded, in first-appearance order — the
 * protocol's ground truth for a bring-limited format's selection. One entry
 * per BODY: an in-battle forme change (Terapagos-Terastal → -Stellar) keeps
 * its first-seen name instead of counting twice (the VGC-tranche sighting
 * caught exactly that).
 */
export function broughtSpeciesFor(snapshots: TurnSnapshot[], side: 'p1' | 'p2', rules: GameRules): string[] {
  const seenBases = new Set<string>();
  const ordered: string[] = [];
  for (const turn of snapshots) {
    for (const pokemon of turn[side].pokemon) {
      if (!pokemon.isActive) continue;
      const base = speciesBaseId(pokemon.speciesForme, rules);
      if (seenBases.has(base)) continue;
      seenBases.add(base);
      ordered.push(pokemon.speciesForme);
    }
  }
  return ordered;
}

/**
 * The bring lists for a bring-limited replay, or null for bring-all
 * formats AND whenever either side's full selection cannot be pinned from
 * the protocol (short games). BOTH sides or neither: evaluating a pinned
 * four against an unpinned six overrates the open side — the A.3c A/B
 * gate flipped a won game (452654) to the loser on exactly that
 * asymmetry, so symmetric-wrong beats asymmetric-wrong.
 */
export function replayBringOnly(
  source: ReplayFormatSource,
  snapshots: TurnSnapshot[],
): { p1: string[]; p2: string[] } | null {
  const bringCount = getReplayBringCount(source);
  if (bringCount === null) return null;
  const rules = replayRules(source);
  const p1 = broughtSpeciesFor(snapshots, 'p1', rules);
  const p2 = broughtSpeciesFor(snapshots, 'p2', rules);
  return p1.length === bringCount && p2.length === bringCount ? { p1, p2 } : null;
}

/** Round 65: the rule set a replay's static weighs by (the engine's StaticRuleset). */
export type ReplayRuleset = 'standard' | 'vgc' | 'champions';

/**
 * Round 65: the rule set of a replay, read from its own format id. Pokémon
 * Champions (Champions OU, Champions VGC) is its own game, reconstructed on
 * the Champions mod since round 67 (getBranchSimulatorFormat); VGC outside
 * Champions (bring six, pick four, level 50) parts from Doubles OU. The
 * hosts name the rule set from here and the engine weighs its statics by it.
 */
export function replayRuleset(source: ReplayFormatSource): ReplayRuleset {
  const format = inferReplayFormatId(source);
  if (isChampionsFormat(format)) return 'champions';
  return /vgc/.test(format) ? 'vgc' : 'standard';
}

/** The branch format carries the clause as a custom-rule suffix — is it there? */
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
 * Round 67 (T145): the Champions mod's formats (@pkmn/mods champions) a
 * Champions replay branches on. Singles play the mod's OU; doubles play its
 * Doubles Custom Game, which brings the whole team as Doubles OU does (the
 * reconstruction trims to the brought Pokémon itself, where a VGC format's
 * team preview would keep the first four). The regulation changes only
 * legality, and the base Dex resolves no custom-rule suffix on a mod format.
 */
const CHAMPIONS_SINGLES_FORMAT = 'gen9championsou';
const CHAMPIONS_DOUBLES_FORMAT = 'gen9championsdoublescustomgame';

export function getBranchSimulatorFormat(source: ReplayFormatSource): string {
  const formatid = inferReplayFormatId(source);
  const gameType = getReplayGameType(source.log);
  const gen = extractGen({ ...source, formatid });
  const doubles = gameType === 'doubles' || formatid.includes('doubles') || formatid.includes('vgc');

  if (replayRuleset(source) === 'champions') return doubles ? CHAMPIONS_DOUBLES_FORMAT : CHAMPIONS_SINGLES_FORMAT;
  if (doubles) return `gen${gen}doublesou`;

  // A formatid the sim doesn't know (draft leagues, video pipelines) runs as
  // a rule-less custom game anyway — name that explicitly so clause suffixes
  // have a real base to attach to.
  const known = formatid && simFormats().get(formatid).exists ? formatid : '';
  const base = known || (formatid ? `gen${gen}customgame` : `gen${gen}ou`);
  return `${base}${sleepClauseSuffix(source.log, base)}`;
}
