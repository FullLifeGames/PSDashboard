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

export function inferReplayFormatId(source: ReplayFormatSource): string {
  const explicit = toId(source.formatid);
  if (explicit) return explicit;

  const fromReplayId = toId(stripReplayNumber(source.id));
  if (fromReplayId) return fromReplayId;

  const fromTier = toId(extractTier(source.log));
  if (fromTier) return fromTier;

  const fromFormat = toId(source.format);
  if (fromFormat) return fromFormat;

  return `gen${extractGen(source)}ou`;
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
