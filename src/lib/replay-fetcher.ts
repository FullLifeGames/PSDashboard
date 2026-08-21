import type { ReplayData } from '../types';
import { replayDataFromLog } from './replay-file';
import { getReplayDisplayFormat, inferReplayFormatId, splitReplayPassword } from './replay-format';

type ReplayResponse = Omit<ReplayData, 'formatid'> & Partial<Pick<ReplayData, 'formatid'>>;

const REPLAY_HOST = 'https://replay.pokemonshowdown.com';

/**
 * Extracts a replay id from a URL or bare id. Returns null for input that
 * cannot be a replay id (empty field, foreign URLs, stray characters) so the
 * app can explain the problem instead of fetching `/.json` (G1/G2).
 *
 * A private replay's `-{password}pw` suffix is part of the id and is KEPT —
 * the replay server parses it off itself, and stripping it here would ask for
 * a replay the server refuses to serve without the password (G22).
 */
export function parseReplayUrl(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/replay\.pokemonshowdown\.com\/([a-z0-9-]+)/i);
  if (match) return match[1].toLowerCase();

  const bare = trimmed.replace(/\.(json|log)$/i, '');
  if (/^[a-z0-9-]+$/i.test(bare)) return bare.toLowerCase();

  return null;
}

/**
 * The replay host sends no CORS headers on its 404s, so a missing replay and a
 * network failure are indistinguishable in the browser (G1): a rejected fetch
 * carries no status at all. Report the status when there is one and null when
 * the request never produced a response.
 */
async function requestReplay(url: string): Promise<Response | null> {
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}

function describeFailure(id: string, status: number | null): string {
  const base = status !== null
    ? `Replay "${id}" was not found (HTTP ${status}).`
    : `Could not load "${id}" — the replay does not exist or the network request failed.`;

  // A password suffix says the link is a private replay, where "not found" has
  // its own specific causes — an incomplete copy of the link, a rotated
  // password, or a replay set back to private-without-password (G22).
  const [, password] = splitReplayPassword(id);
  if (password) {
    return `${base} This is a private replay link: it only loads with the full "-…pw" password suffix intact, ` +
      'and stops loading if the replay was deleted or its privacy was changed. Copy the link again from the replay page.';
  }
  return `${base} Double-check the replay id.`;
}

/** Reads a JSON replay payload, or null when the body is not replay JSON. */
async function readReplayJson(res: Response): Promise<ReplayResponse | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text) as ReplayResponse | null;
    return data && typeof data === 'object' ? data : null;
  } catch {
    // An HTML error page served with a 200 would otherwise surface to the user
    // as `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
    return null;
  }
}

function hasLog(data: ReplayResponse | null): boolean {
  return !!data && typeof data.log === 'string' && data.log.trim().length > 0;
}

function finalize(data: ReplayResponse): ReplayData {
  const formatid = inferReplayFormatId(data);
  return {
    ...data,
    formatid,
    format: getReplayDisplayFormat(data, formatid),
  };
}

export async function fetchReplay(urlOrId: string): Promise<ReplayData> {
  const id = parseReplayUrl(urlOrId);
  if (!id) {
    throw new Error(
      'That does not look like a replay link or id. Paste a replay.pokemonshowdown.com URL or a plain id like "gen9ou-123456789".',
    );
  }

  const jsonRes = await requestReplay(`${REPLAY_HOST}/${id}.json`);
  const data = jsonRes?.ok ? await readReplayJson(jsonRes) : null;
  if (data && hasLog(data)) return finalize(data);

  // The log lives behind a second route on the replay server, and the two do
  // not always answer alike — the JSON route can come back empty, non-JSON, or
  // refused while `.log` still serves the battle. Falling back costs one
  // request on a path that was already failing, and it is the documented way
  // to ask for the log alone.
  const logRes = await requestReplay(`${REPLAY_HOST}/${id}.log`);
  if (logRes?.ok) {
    const log = await logRes.text();
    if (log.trim() && /^\|/m.test(log)) {
      // Metadata from the JSON route is still worth keeping when it arrived
      // without a log — it carries the true format id, players, and uploadtime.
      return data ? finalize({ ...data, log }) : replayDataFromLog(log, id);
    }
  }

  if (data) {
    throw new Error(
      `Replay "${id}" came back without a battle log — the replay server has a record for it but no replayable battle.`,
    );
  }
  throw new Error(describeFailure(id, jsonRes && !jsonRes.ok ? jsonRes.status : null));
}
