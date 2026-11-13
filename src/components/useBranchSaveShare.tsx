import { useState } from 'react';
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

function shareUrl(encoded: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#branch=${encoded}`;
}

/** The share link of the current branch and whether the clipboard took it. */
function useShareLink(build: () => SavedBranch) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const createLink = async () => {
    const nextLink = shareUrl(encodeBranchShare(build()));
    setLink(nextLink);
    setCopied(false);
    try {
      await navigator.clipboard?.writeText(nextLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return { link, copied, createLink };
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

  // Built when the user asks (a click), never per render: a game's link packs both teams.
  const build = (): SavedBranch => (game
    ? makeGameSharePayload({ record: game.record, variation: { startTurn: branchTurn, history }, view: game.view })
    : makeBranchSharePayload({ replay: replayData, branchTurn, history, finalLog }));
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
