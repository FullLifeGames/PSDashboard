import type { BranchSharePayload } from '../lib/branch-share';

/** Round 84 (A7i): the parts of the save and share logic that draw something; `useBranchSaveShare` wires them to the history panel. */

export function ShareLinkField({ link }: { link: string }) {
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

/** The saved branches of this replay, one row each, for the body of the history panel. */
export function SavedList({ saved, onOpen, onRemove }: {
  saved: BranchSharePayload[];
  onOpen: (entry: BranchSharePayload) => void;
  onRemove: (entry: BranchSharePayload) => void;
}) {
  if (saved.length === 0) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
      <div style={{ fontSize: 10, color: '#8899aa' }}>Saved branches</div>
      {saved.map((entry, index) => (
        // The index joins the key: rows saved before the stamps were unique may share createdAt and branchTurn.
        <SavedBranchRow key={`${entry.createdAt}-${entry.branchTurn}-${index}`} entry={entry} onOpen={onOpen} onRemove={onRemove} />
      ))}
    </div>
  );
}
