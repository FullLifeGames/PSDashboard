import { useMemo, useState } from 'react';
import type { BranchHistoryEntry } from '../hooks/useBranch';
import {
  deleteSavedBranch,
  encodeBranchShare,
  loadSavedBranches,
  makeBranchSharePayload,
  saveBranchPayload,
  type BranchSharePayload,
} from '../lib/branch-share';
import type { ReplayData } from '@fulllifegames/replay-core';

interface Props {
  replayData: ReplayData;
  branchTurn: number;
  history: BranchHistoryEntry[];
  finalLog: string;
}

function shareUrl(encoded: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#branch=${encoded}`;
}

function ShareLinkField({ link }: { link: string }) {
  return (
    <input
      readOnly
      value={link}
      aria-label="Branch share link"
      style={{
        width: '100%',
        marginTop: 8,
        fontSize: 10,
        color: '#cde',
        background: 'rgba(0,0,0,0.22)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        padding: 5,
      }}
      onFocus={event => event.currentTarget.select()}
    />
  );
}

function SavedBranchRow({ entry, onOpen, onRemove }: {
  entry: BranchSharePayload;
  onOpen: (entry: BranchSharePayload) => void;
  onRemove: (entry: BranchSharePayload) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        fontSize: 10,
        color: '#b8c7dc',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: 4,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        Turn {entry.branchTurn} branch, {entry.choices.length} choices
        <span style={{ marginLeft: 6, color: '#8899aa' }}>{new Date(entry.createdAt).toLocaleString()}</span>
      </span>
      <span style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
        <button
          type="button"
          className="ps-btn"
          onClick={() => onOpen(entry)}
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Open
        </button>
        <button
          type="button"
          className="ps-btn"
          onClick={() => onRemove(entry)}
          aria-label={`Delete saved branch from turn ${entry.branchTurn}`}
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Delete
        </button>
      </span>
    </div>
  );
}

/** The share link of the current branch and whether the clipboard took it. */
function useShareLink(payload: BranchSharePayload) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const createLink = async () => {
    const nextLink = shareUrl(encodeBranchShare(payload));
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

export function BranchSaveSharePanel({ replayData, branchTurn, history, finalLog }: Props) {
  const [saved, setSaved] = useState<BranchSharePayload[]>(() => loadSavedBranches(replayData.id));

  const payload = useMemo(() => makeBranchSharePayload({
    replay: replayData,
    branchTurn,
    history,
    finalLog,
  }), [replayData, branchTurn, history, finalLog]);
  const { link, copied, createLink } = useShareLink(payload);

  const saveBranch = () => {
    setSaved(saveBranchPayload(payload));
  };

  // Opening a saved branch reuses the share-link flow: setting the hash
  // triggers the app's hashchange handler and shows the read-only view (G16).
  const openSaved = (entry: BranchSharePayload) => {
    window.location.assign(`#branch=${encodeBranchShare(entry)}`);
  };

  const removeSaved = (entry: BranchSharePayload) => {
    setSaved(deleteSavedBranch(entry));
  };

  return (
    <div className="ps-panel" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 'bold' }}>Save / Share Branch</div>
          <div style={{ fontSize: 10, color: '#8899aa' }}>
            Stores replay id, branch turn, choices, and final branch log.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="ps-btn" onClick={saveBranch} style={{ padding: '3px 8px', fontSize: 10 }}>
            Save Branch
          </button>
          <button type="button" className="ps-btn" onClick={createLink} style={{ padding: '3px 8px', fontSize: 10 }}>
            Copy Share Link
          </button>
        </div>
      </div>

      {link && <ShareLinkField link={link} />}

      {copied && (
        <div style={{ marginTop: 4, fontSize: 10, color: '#8fd19e' }}>Copied to clipboard.</div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
          {saved.map(entry => (
            <SavedBranchRow key={`${entry.createdAt}-${entry.branchTurn}`} entry={entry} onOpen={openSaved} onRemove={removeSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
