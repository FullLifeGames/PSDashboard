import {
  type ReplayData, getReplayDisplayFormat, inferReplayFormatId, splitReplayPassword,
} from '@fulllifegames/replay-core';
import { replayDataFromLog } from './replay-file';

type ReplayResponse = Omit<ReplayData, 'formatid'> & Partial<Pick<ReplayData, 'formatid'>>;

const REPLAY_HOST = 'https://replay.pokemonshowdown.com';

/** The replay id of a URL or bare id (null if none); a private replay's `-{password}pw` suffix stays part of it. */
export function parseReplayUrl(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/replay\.pokemonshowdown\.com\/([a-z0-9-]+)/i) ?? trimmed.match(/psim\.us\/r\/([a-z0-9-]+)/i);
  if (match) return match[1].toLowerCase();

  const bare = trimmed.replace(/[?#].*$/, '').replace(/\.(json|log)$/i, '');
  if (/^[a-z0-9-]+$/i.test(bare) && bare.length > 0) return bare.toLowerCase();

  return null;
}

// The replay host sends no CORS headers on its 404s: a rejected fetch has no status, so a missing replay reads as null.
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
    : `Could not load "${id}": the replay does not exist or the network request failed.`;

  // A password suffix says the link is a private replay (incomplete copy, rotated password, or set back to private).
  const [, password] = splitReplayPassword(id);
  if (password) {
    return `${base} This is a private replay link: it only loads with the full "-…pw" password suffix intact, ` +
      'and stops loading if the replay was deleted or its privacy was changed. Copy the link again from the replay page.';
  }
  return `${base} Double-check the replay id.`;
}

async function readReplayJson(res: Response): Promise<ReplayResponse | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text) as ReplayResponse | null;
    return data && typeof data === 'object' ? data : null;
  } catch {
    // An HTML error page served with a 200 is no replay JSON.
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

/** The Showdown viewer-perspective flag of a link (`…?p2`): the literal query key, never a substring of the id. */
export function parseReplayViewpoint(input: string): 'p1' | 'p2' {
  const flag = input.trim().match(/[?&](p[12])(?=$|[&#=])/i);
  return flag ? flag[1].toLowerCase() as 'p1' | 'p2' : 'p1';
}

export async function fetchReplay(urlOrId: string): Promise<ReplayData> {
  const id = parseReplayUrl(urlOrId);
  if (!id) {
    throw new Error(
      'That does not look like a replay link or id. Paste a replay.pokemonshowdown.com or psim.us/r link, or a plain id like "gen9ou-123456789".',
    );
  }

  const viewpoint = parseReplayViewpoint(urlOrId);
  const withViewpoint = (data: ReplayData): ReplayData =>
    viewpoint === 'p2' ? { ...data, viewpoint } : data;

  const jsonRes = await requestReplay(`${REPLAY_HOST}/${id}.json`);
  const data = jsonRes?.ok ? await readReplayJson(jsonRes) : null;
  if (data && hasLog(data)) return withViewpoint(finalize(data));

  // The JSON route can come back empty, non-JSON or refused while `.log` still serves the battle.
  const logRes = await requestReplay(`${REPLAY_HOST}/${id}.log`);
  if (logRes?.ok) {
    const log = await logRes.text();
    if (log.trim() && /^\|/m.test(log)) {
      // Metadata from the JSON route (the true format id, players, uploadtime) is kept when it arrived without a log.
      return data ? withViewpoint(finalize({ ...data, log })) : withViewpoint(replayDataFromLog(log, id));
    }
  }

  if (data) {
    throw new Error(
      `Replay "${id}" came back without a battle log: the replay server has a record for it but no replayable battle.`,
    );
  }
  throw new Error(describeFailure(id, jsonRes && !jsonRes.ok ? jsonRes.status : null));
}
