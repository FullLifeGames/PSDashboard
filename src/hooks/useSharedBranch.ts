import { useCallback, useEffect, useRef, useState } from 'react';
import { readShare, type BranchSharePayload } from '../lib/branch-share';
import type { GameSharePayload } from '../lib/new-game/share';

const DAMAGED = 'This share link is invalid or damaged. Ask for a fresh link.';
const newerNotice = (version: number) => `This share link comes from a newer PS Dashboard (link version ${version}). Reload the page for the latest version, then open it again.`;

/**
 * The #branch= share-link state: decoded payload, damage notice, clear. Round 89 (#105, H5): a version 1 link (a replay's branch) is
 * the read-only view as before; a version 2 link (a game) lands in `sharedGame`, which the app opens as a game and then clears; a
 * link of a version above 2 says it comes from a newer app and keeps its hash, so a reload on the newer app opens it.
 */
export function useSharedBranch(): {
  sharedBranch: BranchSharePayload | null;
  sharedGame: GameSharePayload | null;
  sharedBranchError: string | null;
  clearSharedBranch: () => void;
} {
  const [sharedBranch, setSharedBranch] = useState<BranchSharePayload | null>(null);
  const [sharedGame, setSharedGame] = useState<GameSharePayload | null>(null);
  const [sharedBranchError, setSharedBranchError] = useState<string | null>(null);
  // The link text the state holds: the same text again (the mount and a hashchange that follows it, a remount in development) keeps
  // the payload object, so a game link opens once.
  const heldHash = useRef<string | null>(null);

  // Share links must also work in an already-open tab (G17) — listen for
  // hash changes instead of only parsing on the initial load.
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
        // A damaged link gets a readable message instead of a raw JSON parse
        // error, and the broken hash leaves the URL (G18).
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
