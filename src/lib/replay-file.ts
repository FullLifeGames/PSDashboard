import { type ReplayData, getReplayDisplayFormat, inferReplayFormatId } from '@fulllifegames/replay-core';

const LOG_DATA_PATTERN = /<script[^>]*class="battle-log-data"[^>]*>([\s\S]*?)<\/script>/i;
const REPLAY_ID_PATTERN = /<input[^>]*name="replayid"[^>]*value="([a-z0-9-]+)"/i;

export function looksLikeReplayFileContent(input: string): boolean {
  const content = input.trim();
  if (!content) return false;
  return content.includes('battle-log-data') || /^\|/m.test(content);
}

function playerName(log: string, side: 'p1' | 'p2'): string {
  const match = log.match(new RegExp(`^\\|player\\|${side}\\|([^|\\n]+)`, 'm'));
  return match?.[1].trim() || (side === 'p1' ? 'Player 1' : 'Player 2');
}

function fileNameId(fileName: string | undefined): string {
  return (fileName || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Turns a "Download replay" export or raw log into ReplayData (the export escapes `/` as `\/`). */
export function parseExportedReplay(content: string, fileName?: string): ReplayData {
  const trimmed = content.replace(/^\uFEFF/, '').trim();

  let log: string | null = null;
  let embeddedId: string | null = null;

  const script = trimmed.match(LOG_DATA_PATTERN);
  if (script) {
    log = script[1].replace(/\\\//g, '/').trim();
    embeddedId = trimmed.match(REPLAY_ID_PATTERN)?.[1]?.toLowerCase() ?? null;
  } else if (!trimmed.startsWith('<') && /^\|/m.test(trimmed)) {
    log = trimmed;
  }

  if (!log || !/^\|/m.test(log)) {
    throw new Error(
      'This file does not look like an exported replay. Expected a downloaded replay .html from replay.pokemonshowdown.com or a raw battle log.',
    );
  }

  return replayDataFromLog(log, embeddedId || fileNameId(fileName) || 'imported-replay', embeddedId);
}

/** ReplayData from a bare protocol log; `inferenceId` may feed format inference, a file name never may (null). */
export function replayDataFromLog(log: string, id: string, inferenceId: string | null = id): ReplayData {
  // A surviving \r on a line-final field (tera type, win line) poisons built teams and crashes the sim's team parsing.
  const normalized = log.replace(/\r\n?/g, '\n');

  const tier = normalized.match(/^\|tier\|([^|\n]+)/m)?.[1]?.trim() ?? '';
  const formatid = inferReplayFormatId({ id: inferenceId ?? undefined, log: normalized, format: tier });

  return {
    id,
    format: getReplayDisplayFormat({ log: normalized, format: tier }, formatid),
    formatid,
    players: [playerName(normalized, 'p1'), playerName(normalized, 'p2')],
    log: normalized,
    uploadtime: Number.parseInt(normalized.match(/^\|t:\|(\d+)/m)?.[1] ?? '0', 10),
    views: 0,
  };
}
