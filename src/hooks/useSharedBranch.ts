import { useCallback, useEffect, useRef, useState } from 'react';
import { readShare, type BranchSharePayload } from '../lib/branch-share';
import type { GameSharePayload } from '../lib/new-game/share';

const DAMAGED = 'This share link is invalid or damaged. Ask for a fresh link.';
const newerNotice = (version: number) => `This share link comes from a newer PS Dashboard (link version ${version}). Reload the page for the latest version, then open it again.`;

/** The #branch= share-link state: payload, damage notice, clear; a version above 2 keeps its hash for the newer app. */
export function useSharedBranch(): {
  sharedBranch: BranchSharePayload | null;
  sharedGame: GameSharePayload | null;
  sharedBranchError: string | null;
  clearSharedBranch: () => void;
} {
  const [sharedBranch, setSharedBranch] = useState<BranchSharePayload | null>(null);
  const [sharedGame, setSharedGame] = useState<GameSharePayload | null>(null);
  const [sharedBranchError, setSharedBranchError] = useState<string | null>(null);
  // The same text again (mount, hashchange, dev remount) keeps the payload object, so a game link opens once.
  const heldHash = useRef<string | null>(null);

  useEffect(() => {
    const applyHash = () => {
      const match = window.location.hash.match(/^#branch=(.+)$/);
      if (!match) {
        heldHash.current = null;
        setSharedBranch(null);
        setSharedGame(null);
        return;
      }

      if (heldHash.current === match[1]) return;
      heldHash.current = match[1];
      try {
        const read = readShare(match[1]);
        setSharedBranch(read.kind === 'branch' ? read.payload : null);
        setSharedGame(read.kind === 'game' ? read.payload : null);
        setSharedBranchError(read.kind === 'newer' ? newerNotice(read.version) : null);
      } catch {
        setSharedBranch(null);
        setSharedGame(null);
        heldHash.current = null;
        setSharedBranchError(DAMAGED);
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const clearSharedBranch = useCallback(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    heldHash.current = null;
    setSharedBranch(null);
    setSharedGame(null);
    setSharedBranchError(null);
  }, []);

  return { sharedBranch, sharedGame, sharedBranchError, clearSharedBranch };
}
