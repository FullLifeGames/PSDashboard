import type { ReplayData } from '../types';
import { getReplayGeneration, inferReplayFormatId } from './replay-format';

type ReplayResponse = Omit<ReplayData, 'formatid'> & Partial<Pick<ReplayData, 'formatid'>>;

/**
 * Extracts a replay id from a URL or bare id. Returns null for input that
 * cannot be a replay id (empty field, foreign URLs, stray characters) so the
 * app can explain the problem instead of fetching `/.json` (G1/G2).
 */
export function parseReplayUrl(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/replay\.pokemonshowdown\.com\/([a-z0-9-]+)/i);
  if (match) return match[1].toLowerCase();

  const bare = trimmed.replace(/\.json$/i, '');
  if (/^[a-z0-9-]+$/i.test(bare)) return bare.toLowerCase();

  return null;
}

/** Prefixes the generation when the display format omits it ("Ubers" → "[Gen 6] Ubers", G5). */
function displayFormat(data: ReplayResponse, formatid: string): string {
  const format = (data.format || '').trim();
  if (!format) return formatid;
  if (/gen\s*\d/i.test(format)) return format;
  const gen = getReplayGeneration({ ...data, formatid });
  return `[Gen ${gen}] ${format}`;
}

export async function fetchReplay(urlOrId: string): Promise<ReplayData> {
  const id = parseReplayUrl(urlOrId);
  if (!id) {
    throw new Error(
      'That does not look like a replay link or id. Paste a replay.pokemonshowdown.com URL or a plain id like "gen9ou-123456789".',
    );
  }

  const url = `https://replay.pokemonshowdown.com/${id}.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // replay.pokemonshowdown.com sends no CORS headers on 404s, so a missing
    // replay and a network failure are indistinguishable in the browser (G1).
    throw new Error(
      `Could not load "${id}" — the replay does not exist or the network request failed. Double-check the replay id.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Replay "${id}" was not found (HTTP ${res.status}).`);
  }

  const data = await res.json() as ReplayResponse;
  const formatid = inferReplayFormatId(data);
  return {
    ...data,
    formatid,
    format: displayFormat(data, formatid),
  };
}
