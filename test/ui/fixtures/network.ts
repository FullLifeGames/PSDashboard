import { vi } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';

/** Everything but the replay JSON answers 404, so a loaded replay settles with no usage stats. */
export function stubReplayFetch(replays: ReplayData[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const replay = replays.find(entry => url.includes(`/${entry.id}`));
    if (replay && url.includes('replay.pokemonshowdown.com')) {
      return new Response(JSON.stringify(replay), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
