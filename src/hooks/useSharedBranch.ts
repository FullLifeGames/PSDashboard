import { useCallback, useEffect, useState } from 'react';
import { decodeBranchShare, type BranchSharePayload } from '../lib/branch-share';

/** The #branch= share-link state: decoded payload, damage notice, clear. */
export function useSharedBranch(): {
  sharedBranch: BranchSharePayload | null;
  sharedBranchError: string | null;
  clearSharedBranch: () => void;
} {
  const [sharedBranch, setSharedBranch] = useState<BranchSharePayload | null>(null);
  const [sharedBranchError, setSharedBranchError] = useState<string | null>(null);

  // Share links must also work in an already-open tab (G17) — listen for
  // hash changes instead of only parsing on the initial load.
  useEffect(() => {
    const applyHash = () => {
      const match = window.location.hash.match(/^#branch=(.+)$/);
      if (!match) {
        setSharedBranch(null);
        return;
      }

      try {
        const decoded = decodeBranchShare(match[1]);
        if (decoded.version !== 1 || !decoded.finalLog || !decoded.replayId) {
          throw new Error('unsupported payload');
        }
        setSharedBranch(decoded);
        setSharedBranchError(null);
      } catch {
        // A damaged link gets a readable message instead of a raw JSON parse
        // error, and the broken hash leaves the URL (G18).
        setSharedBranch(null);
        setSharedBranchError('This share link is invalid or damaged. Ask for a fresh link.');
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const clearSharedBranch = useCallback(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setSharedBranch(null);
    setSharedBranchError(null);
  }, []);

  return { sharedBranch, sharedBranchError, clearSharedBranch };
}
