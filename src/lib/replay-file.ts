import type { ReplayData } from '../types';
import { getReplayDisplayFormat, inferReplayFormatId } from './replay-format';

const LOG_DATA_PATTERN = /<script[^>]*class="battle-log-data"[^>]*>([\s\S]*?)<\/script>/i;
const REPLAY_ID_PATTERN = /<input[^>]*name="replayid"[^>]*value="([a-z0-9-]+)"/i;

/**
 * Distinguishes pasted/posted replay *content* (an exported HTML document or
 * a raw protocol log) from a replay id or URL that must be fetched.
 */
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

/**
 * Turns a "Download replay" export from replay.pokemonshowdown.com (or a raw
 * protocol log file) into the same ReplayData shape the replay API returns.
 * The export wraps the log in a text/plain script with `/` escaped as `\/`.
 */
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

  // Externally written files (video reconstructions, Windows editors) come
  // with CRLF. Everything downstream splits on '\n' — a surviving \r on a
  // line-final field (tera type, win line) poisons built teams and crashes
  // the sim's JSON team parsing. Normalize once, here, at the door.
  log = log.replace(/\r\n?/g, '\n');

  const tier = log.match(/^\|tier\|([^|\n]+)/m)?.[1]?.trim() ?? '';
  // Only a real replay id may feed format inference — a file name is
  // arbitrary text and would corrupt the inferred format id.
  const formatid = inferReplayFormatId({ id: embeddedId ?? undefined, log, format: tier });

  return {
    id: embeddedId || fileNameId(fileName) || 'imported-replay',
    format: getReplayDisplayFormat({ log, format: tier }, formatid),
    formatid,
    players: [playerName(log, 'p1'), playerName(log, 'p2')],
    log,
    uploadtime: Number.parseInt(log.match(/^\|t:\|(\d+)/m)?.[1] ?? '0', 10),
    views: 0,
  };
}
