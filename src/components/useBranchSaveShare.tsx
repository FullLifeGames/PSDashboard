import { useCallback, useState } from 'react';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { BranchHistoryEntry } from '../hooks/useBranch';
import type { BranchHistorySlots } from './BranchHistoryPanel';
import { SavedList, ShareLinkField } from './BranchSaveSharePanel';
import type { NewGameRecord } from '../lib/new-game/record';
import { makeGameSharePayload, type GameSharePayload } from '../lib/new-game/share';
import {
  deleteSavedBranch,
  encodeBranchShare,
  loadSavedBranches,
  makeBranchSharePayload,
  saveBranchPayload,
  type SavedBranch,
} from '../lib/branch-share';

interface Props {
  replayData: ReplayData;
  branchTurn: number;
  history: BranchHistoryEntry[];
  finalLog: string;
  /** A new game (round 89, #105, H5): its record and where the pointer stands. The branch then shares as a game (link version 2). */
  game?: { record: NewGameRecord; view: GameSharePayload['view'] } | null;
}

export function shareUrl(encoded: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#branch=${encoded}`;
}

/**
 * The share link of the current branch and whether the clipboard took it. Once the field is filled it follows the variation: when
 * the inputs change (`build` is a new function), the link is built again during render (round 89: a line that replaced the
 * variation left the old link in the field), and a "Copied" belongs to the build it copied, so a changed variation shows none
 * until the next copy. The link in the field is the one the click built, so the clipboard and the field carry one timestamp, and
 * nothing is built before the first click (a game's link packs both teams).
 */
function useShareLink(build: () => SavedBranch) {
  const [built, setBuilt] = useState<{ build: () => SavedBranch; link: string } | null>(null);
  const [copiedFor, setCopiedFor] = useState<(() => SavedBranch) | null>(null);
  if (built && built.build !== build) setBuilt({ build, link: shareUrl(encodeBranchShare(build())) });
  const createLink = async () => {
    const nextLink = shareUrl(encodeBranchShare(build()));
    setBuilt({ build, link: nextLink });
    setCopiedFor(null);
    try {
      await navigator.clipboard?.writeText(nextLink);
      setCopiedFor(() => build);
    } catch {
      setCopiedFor(null);
    }
  };
  return { link: built?.link ?? '', copied: copiedFor === build, createLink };
}

const SAVE_TITLE = 'Stores the replay id, branch turn, choices and final branch log in this browser.';
const SHARE_TITLE = 'Copies a link that opens this branch read-only.';
const GAME_SAVE_TITLE = "Stores this game's branch in this browser.";
const GAME_SHARE_TITLE = 'Copies a link that opens this game and its open branch at this turn.';
const SAVED_NOTICE = 'Saved. The saved branches are listed under Variation moves.';

const buttonStyle = { padding: '3px 8px', fontSize: 10 };

/**
 * Round 84 (A7i, ruling 20a): the save and share logic of a branch, handed to the history panel as slots. The buttons stand on its
 * toggle line, the link field and the one line after a save under it, the saved rows in its body. The payload and the link logic
 * stay here; the panel imports no branch-share module.
 */
export function useBranchSaveShare({ replayData, branchTurn, history, finalLog, game = null }: Props): BranchHistorySlots {
  const [saved, setSaved] = useState<SavedBranch[]>(() => loadSavedBranches(replayData.id));
  const [justSaved, setJustSaved] = useState(false);

  // Built when the user asks (a click) or, once a link is shown, when its inputs change; never per render before that. `game` is a
  // fresh object each render, so the build depends on its fields.
  const gameRecord = game?.record ?? null;
  const viewTurn = game?.view?.turn ?? 0;
  const viewLine = game?.view?.line ?? 'main';
  const viewT0 = game?.view?.t0 ?? false;
  const build = useCallback((): SavedBranch => (gameRecord
    ? makeGameSharePayload({
      record: gameRecord, variation: { startTurn: branchTurn, history },
      view: { turn: viewTurn, line: viewLine, ...(viewT0 ? { t0: true } : {}) },
    })
    : makeBranchSharePayload({ replay: replayData, branchTurn, history, finalLog })),
  [gameRecord, viewTurn, viewLine, viewT0, replayData, branchTurn, history, finalLog]);
  const { link, copied, createLink } = useShareLink(build);

  const saveBranch = () => {
    setSaved(saveBranchPayload(build()));
    setJustSaved(true);
  };

  // Opening a saved branch reuses the share-link flow: setting the hash
  // triggers the app's hashchange handler (G16). A replay's branch shows the read-only view; a game's row is a version 2 link,
  // which opens the branch in the game (H5).
  const openSaved = (entry: SavedBranch) => {
    window.location.assign(`#branch=${encodeBranchShare(entry)}`);
  };

  const removeSaved = (entry: SavedBranch) => {
    setSaved(deleteSavedBranch(entry));
  };

  return {
    actions: (
      <>
        <button type="button" className="ps-btn" onClick={saveBranch} title={game ? GAME_SAVE_TITLE : SAVE_TITLE} style={buttonStyle}>Save Branch</button>
        <button type="button" className="ps-btn" onClick={createLink} title={game ? GAME_SHARE_TITLE : SHARE_TITLE} style={buttonStyle}>Copy Share Link</button>
      </>
    ),
    status: open => (
      <>
        {link && <ShareLinkField link={link} />}
        {copied && <div style={{ marginTop: 4, fontSize: 10, color: '#8fd19e' }}>Copied to clipboard.</div>}
        {justSaved && !open && <div style={{ marginTop: 4, fontSize: 10, color: '#8fd19e' }}>{SAVED_NOTICE}</div>}
      </>
    ),
    saved: <SavedList saved={saved} onOpen={openSaved} onRemove={removeSaved} />,
    // The saved rows show once the body opens, so the line about the save has done its work.
    onOpenChange: open => { if (open) setJustSaved(false); },
  };
}
