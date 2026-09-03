import { Dex } from '@pkmn/sim';
import type { ReplayData, TurnSnapshot } from './types.ts';
import { toId } from './ids.ts';

type ReplayFormatSource = Partial<Pick<ReplayData, 'id' | 'format' | 'formatid' | 'log'>>;

/** Optional-input wrapper: an absent field normalizes to the empty id. */
const optionalId = (value: string | undefined): string => toId(value ?? '');

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

function extractTier(log: string | undefined): string {
  return log?.match(/^\|tier\|([^|\n]+)/m)?.[1] ?? '';
}

function extractGen(source: ReplayFormatSource & { formatid?: string }): string {
  const fromFormatId = source.formatid?.match(/^gen(\d+)/)?.[1];
  if (fromFormatId) return fromFormatId;

  const fromLog = source.log?.match(/^\|gen\|(\d+)/m)?.[1];
  if (fromLog) return fromLog;

  const fromFormat = optionalId(source.format || extractTier(source.log)).match(/gen(\d+)/)?.[1];
  if (fromFormat) return fromFormat;

  return '9';
}

export function getReplayGameType(log: string | undefined): string | null {
  const raw = log?.match(/^\|gametype\|([^|\n]+)/m)?.[1];
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
function sleepClauseSuffix(log: string | undefined, base: string): string {
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
 * The Dex's own rule table answers for formats it knows; current VGC
 * regulations often postdate the bundled sim, so the format-id heuristic
 * covers them (every VGC ruleset to date brings 4).
 */
export function getReplayBringCount(source: ReplayFormatSource): number | null {
  const formatid = inferReplayFormatId(source);
  if (!formatid) return null;
  const format = Dex.formats.get(formatid);
  if (format.exists) {
    try {
      const size = Dex.formats.getRuleTable(format).pickedTeamSize;
      if (typeof size === 'number' && size > 0) return size;
      return null;
    } catch {
      // Rule table refused (mod gaps) — fall through to the heuristic.
    }
  }
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
export function speciesBaseId(name: string): string {
  const species = Dex.species.get(name);
  return optionalId(species.exists ? species.baseSpecies || species.name : name);
}

/**
 * The species each side actually fielded, in first-appearance order — the
 * protocol's ground truth for a bring-limited format's selection. One entry
 * per BODY: an in-battle forme change (Terapagos-Terastal → -Stellar) keeps
 * its first-seen name instead of counting twice (the VGC-tranche sighting
 * caught exactly that).
 */
export function broughtSpeciesFor(snapshots: TurnSnapshot[], side: 'p1' | 'p2'): string[] {
  const seenBases = new Set<string>();
  const ordered: string[] = [];
  for (const turn of snapshots) {
    for (const pokemon of turn[side].pokemon) {
      if (!pokemon.isActive) continue;
      const base = speciesBaseId(pokemon.speciesForme);
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
  const p1 = broughtSpeciesFor(snapshots, 'p1');
  const p2 = broughtSpeciesFor(snapshots, 'p2');
  return p1.length === bringCount && p2.length === bringCount ? { p1, p2 } : null;
}

/** The branch format carries the clause as a custom-rule suffix — is it there? */
export function formatEnforcesSleepClause(format: string): boolean {
  if (/@@@.*sleep ?clause/i.test(format)) return true;
  const base = Dex.formats.get(format.split('@@@')[0]);
  try {
    return base.exists && Dex.formats.getRuleTable(base).has('sleepclausemod');
  } catch {
    return false;
  }
}

export function getBranchSimulatorFormat(source: ReplayFormatSource): string {
  const formatid = inferReplayFormatId(source);
  const gameType = getReplayGameType(source.log);
  const gen = extractGen({ ...source, formatid });

  if (gameType === 'doubles' || formatid.includes('doubles') || formatid.includes('vgc')) {
    return `gen${gen}doublesou`;
  }

  // A formatid the sim doesn't know (draft leagues, video pipelines) runs as
  // a rule-less custom game anyway — name that explicitly so clause suffixes
  // have a real base to attach to.
  const known = formatid && Dex.formats.get(formatid).exists ? formatid : '';
  const base = known || (formatid ? `gen${gen}customgame` : `gen${gen}ou`);
  return `${base}${sleepClauseSuffix(source.log, base)}`;
}
