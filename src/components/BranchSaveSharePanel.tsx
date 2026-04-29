import { useMemo, useState } from 'react';
import type { BranchHistoryEntry } from '../hooks/useBranch';
import {
  encodeBranchShare,
  loadSavedBranches,
  makeBranchSharePayload,
  saveBranchPayload,
  type BranchSharePayload,
} from '../lib/branch-share';
import type { ReplayData } from '../types';

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

export function BranchSaveSharePanel({ replayData, branchTurn, history, finalLog }: Props) {
  const [saved, setSaved] = useState<BranchSharePayload[]>(() => loadSavedBranches(replayData.id));
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const payload = useMemo(() => makeBranchSharePayload({
    replay: replayData,
    branchTurn,
    history,
    finalLog,
  }), [replayData, branchTurn, history, finalLog]);

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

  const saveBranch = () => {
    setSaved(saveBranchPayload(payload));
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

      {link && (
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
      )}

      {copied && (
        <div style={{ marginTop: 4, fontSize: 10, color: '#8fd19e' }}>Copied to clipboard.</div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {saved.slice(0, 5).map(entry => (
            <div
              key={`${entry.createdAt}-${entry.branchTurn}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 10,
                color: '#b8c7dc',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                paddingTop: 4,
              }}
            >
              <span>Turn {entry.branchTurn} branch, {entry.choices.length} choices</span>
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
