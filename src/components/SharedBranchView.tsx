import { PSReplayFrame } from './PSReplayFrame';
import type { BranchSharePayload } from '../lib/branch-share';

function SharedBranchTopbar({
  branch,
  onLoadOriginal,
  onClear,
}: {
  branch: BranchSharePayload;
  onLoadOriginal: (replayId: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="ps-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <span className="ps-format-tag">{branch.format}</span>
        <span style={{ fontSize: 11, color: '#8ac' }}>{branch.players[0]}</span>
        <span style={{ fontSize: 10, color: '#556' }}>vs</span>
        <span style={{ fontSize: 11, color: '#c8a' }}>{branch.players[1]}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
          Shared Branch
        </span>
        <button
          type="button"
          className="ps-btn"
          onClick={() => onLoadOriginal(branch.replayId)}
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Load Original Replay
        </button>
        <button
          type="button"
          className="ps-btn"
          onClick={onClear}
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          New Replay
        </button>
      </div>
    </div>
  );
}

function SharedBranchChoices({ branch }: { branch: BranchSharePayload }) {
  return (
    <div className="ps-panel ps-shared-branch-panel">
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Branch Choices</div>
      <div style={{ fontSize: 11, color: '#aebdd0', marginBottom: 8 }}>
        Branch started from turn {branch.branchTurn}. This read-only view replays the shared alternate line.
      </div>
      <div className="ps-shared-choice-list">
        {branch.choices.length > 0 ? branch.choices.map(choice => (
          <div key={`${choice.turnNumber}-${choice.p1Choice}-${choice.p2Choice}`} className="ps-shared-choice-row">
            Turn {choice.turnNumber}: P1 {choice.p1Choice} / P2 {choice.p2Choice}
          </div>
        )) : (
          <div className="ps-shared-choice-row">No executed branch choices were stored.</div>
        )}
      </div>
    </div>
  );
}

export function SharedBranchView({
  branch,
  onLoadOriginal,
  onClear,
}: {
  branch: BranchSharePayload;
  onLoadOriginal: (replayId: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="ps-main-layout">
      <div className="ps-main-left">
        <SharedBranchTopbar branch={branch} onLoadOriginal={onLoadOriginal} onClear={onClear} />
        <div className="ps-iframe-wrap">
          <PSReplayFrame
            log={branch.finalLog}
            format={branch.format}
            p1={branch.players[0]}
            p2={branch.players[1]}
            title="Shared Branch Replay"
            height={480}
            seekTurn={branch.branchTurn}
            autoPlay={false}
            reloadKey={`shared:${branch.replayId}:${branch.createdAt}`}
          />
        </div>
        <SharedBranchChoices branch={branch} />
      </div>
      <div className="ps-main-right">
        <div className="ps-panel" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Replay Source</div>
          <div style={{ fontSize: 11, color: '#aebdd0', lineHeight: 1.5 }}>
            Replay id: <strong style={{ color: '#fff' }}>{branch.replayId}</strong>
            <br />
            Created: {new Date(branch.createdAt).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
