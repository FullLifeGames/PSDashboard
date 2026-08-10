import { Dex } from '@pkmn/sim';
import type { ReplayData } from '../types';

type ReplayFormatSource = Partial<Pick<ReplayData, 'id' | 'format' | 'formatid' | 'log'>>;

function toId(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stripReplayNumber(id: string | undefined): string {
  return (id || '').replace(/-\d+$/, '');
}

function extractTier(log: string | undefined): string {
  return log?.match(/^\|tier\|([^|\n]+)/m)?.[1] ?? '';
}

function extractGen(source: ReplayFormatSource & { formatid?: string }): string {
  const fromFormatId = source.formatid?.match(/^gen(\d+)/)?.[1];
  if (fromFormatId) return fromFormatId;

  const fromLog = source.log?.match(/^\|gen\|(\d+)/m)?.[1];
  if (fromLog) return fromLog;

  const fromFormat = toId(source.format || extractTier(source.log)).match(/gen(\d+)/)?.[1];
  if (fromFormat) return fromFormat;

  return '9';
}

export function getReplayGameType(log: string | undefined): string | null {
  const raw = log?.match(/^\|gametype\|([^|\n]+)/m)?.[1];
  return raw ? toId(raw) : null;
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
  const explicit = toId(source.formatid);
  if (explicit) return normalizeInferredFormatId(explicit, source);

  const fromReplayId = toId(stripReplayNumber(source.id));
  if (fromReplayId) return normalizeInferredFormatId(fromReplayId, source);

  const fromTier = toId(extractTier(source.log));
  if (fromTier) return normalizeInferredFormatId(fromTier, source);

  const fromFormat = toId(source.format);
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
      lastMoveWasRest = toId(line.split('|')[3]) === 'rest';
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
  if (/^\|rule\|/m.test(log)) return '';
  if (logShowsSecondSleep(log)) return '';
  return '@@@Sleep Clause Mod';
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
