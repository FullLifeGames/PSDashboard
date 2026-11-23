import { useEffect, useRef, useState } from 'react';
import { loadGame } from '../lib/new-game/store';
import type { NewGameRecord } from '../lib/new-game/record';
import { parseReplayUrl, parseReplayViewpoint } from '../lib/replay-fetcher';

/**
 * The address names what is open, so a reload brings it back: a game is `?game=<id>`; a replay loaded by link or id is `?replay=<id>`
 * (with `?p2` when seen from player 2's side); a replay from a file has none. Written with `replaceState`, so Back leaves the app
 * and does not walk through every replay loaded. Read once at start: a saved game opens at its tip, an unknown game is named for the
 * start page's notice. The embedded view (the host owns the address) and a shared branch (`#branch=` wins, as in `useEmbedHost`)
 * are neither read nor written. A `?replay=` link that already names the loaded replay stays as written.
 */

export interface OpenAddressInputs {
  embed: boolean;
  requestedGame: string | null;
  replayId: string | null;
  viewpoint: 'p1' | 'p2' | undefined;
  /** Whether that replay came by link or id (a file, a game and a host message do not name an address). */
  byLink: boolean;
  openRecord: (record: NewGameRecord) => Promise<unknown> | void;
}

const sharedBranchInAddress = (): boolean => window.location.hash.startsWith('#branch=');

function namesReplay(written: string, id: string, viewpoint: 'p1' | 'p2'): boolean {
  return parseReplayUrl(written) === id.toLowerCase() && parseReplayViewpoint(written) === viewpoint;
}

function wanted({ replayId, viewpoint, byLink }: OpenAddressInputs, written: string | null): ['game' | 'replay', string] | null {
  if (!replayId) return null;
  if (replayId.startsWith('newgame-')) return ['game', replayId];
  if (!byLink) return null;
  const side = viewpoint ?? 'p1';
  return ['replay', written !== null && namesReplay(written, replayId, side) ? written : `${replayId}${side === 'p2' ? '?p2' : ''}`];
}

export function useOpenAddress(inputs: OpenAddressInputs): { missingGame: string | null } {
  const { embed, requestedGame, replayId, viewpoint, byLink, openRecord } = inputs;
  const [start] = useState(() => (embed || !requestedGame || sharedBranchInAddress() ? null : { id: requestedGame, record: loadGame(requestedGame) }));
  const openedRef = useRef(false);
  useEffect(() => {
    if (!start?.record || openedRef.current) return;
    openedRef.current = true;
    void openRecord(start.record);
  }, [start, openRecord]);

  useEffect(() => {
    if (embed || replayId === null || sharedBranchInAddress()) return;
    const url = new URL(window.location.href);
    const want = wanted({ embed, requestedGame, replayId, viewpoint, byLink, openRecord }, url.searchParams.get('replay'));
    // the address already says it, as it was written: not even its encoding changes
    const params = url.searchParams;
    if (want && params.get(want[0]) === want[1] && !params.has(want[0] === 'game' ? 'replay' : 'game')) return;
    url.searchParams.delete('game');
    url.searchParams.delete('replay');
    if (want) url.searchParams.set(want[0], want[1]);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
  }, [embed, requestedGame, replayId, viewpoint, byLink, openRecord]);

  return { missingGame: start && !start.record ? start.id : null };
}
