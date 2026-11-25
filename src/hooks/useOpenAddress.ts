import { useEffect, useRef, useState } from 'react';
import { loadGame } from '../lib/new-game/store';
import type { NewGameRecord } from '../lib/new-game/record';
import { parseReplayUrl, parseReplayViewpoint } from '../lib/replay-fetcher';

/** Read once at start, written with `replaceState` so Back leaves the app; embed and `#branch=` views are skipped. */

export interface OpenAddressInputs {
  embed: boolean;
  requestedGame: string | null;
  replayId: string | null;
  viewpoint: 'p1' | 'p2' | undefined;
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
    // The address already says it: leave it as written, encoding included.
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
