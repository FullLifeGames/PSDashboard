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

export function getReplayGeneration(source: ReplayFormatSource): number {
  const formatid = inferReplayFormatId(source);
  return parseInt(extractGen({ ...source, formatid }), 10) || 9;
}

export function getBranchSimulatorFormat(source: ReplayFormatSource): string {
  const formatid = inferReplayFormatId(source);
  const gameType = getReplayGameType(source.log);
  const gen = extractGen({ ...source, formatid });

  if (gameType === 'doubles' || formatid.includes('doubles') || formatid.includes('vgc')) {
    return `gen${gen}doublesou`;
  }

  return formatid || `gen${gen}ou`;
}
