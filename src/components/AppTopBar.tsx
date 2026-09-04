import type { BranchSimState } from '../hooks/useBranch';

interface AppTopBarProps {
  replayData: { format: string; players: string[] };
  usageStats: { loading: boolean; error: string | null };
  setAssumptions: { loading: boolean; error: string | null };
  branchPreparing: boolean;
  branchProgress: { turn: number; target: number } | null;
  showBranch: boolean;
  simState: BranchSimState | null;
  animateBranchTurns: boolean;
  branchDivergence: string | null;
  onCancelPreparation: () => void;
  onAnimateChange: (value: boolean) => void;
  onEditSide: (side: 'p1' | 'p2') => void;
  onOpenSets: () => void;
}

function TopBarMatchInfo({ replayData, usageStats, setAssumptions }: Pick<AppTopBarProps, 'replayData' | 'usageStats' | 'setAssumptions'>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
      <span className="ps-format-tag">{replayData.format}</span>
      <span style={{ fontSize: 11, color: '#8ac' }}>{replayData.players[0]}</span>
      <span style={{ fontSize: 10, color: '#556' }}>vs</span>
      <span style={{ fontSize: 11, color: '#c8a' }}>{replayData.players[1]}</span>
      {usageStats.loading && (
        <span style={{ fontSize: 10, color: '#b6a46a' }}>Smogon stats loading...</span>
      )}
      {usageStats.error && (
        <span style={{ fontSize: 10, color: '#987' }}>Smogon stats unavailable</span>
      )}
      {setAssumptions.loading && (
        <span style={{ fontSize: 10, color: '#b6a46a' }}>Smogon sets loading...</span>
      )}
      {setAssumptions.error && (
        <span style={{ fontSize: 10, color: '#987' }}>Smogon sets unavailable</span>
      )}
    </div>
  );
}

function TopBarBranchStatus({
  branchPreparing, branchProgress, showBranch, simState,
  animateBranchTurns, branchDivergence, onCancelPreparation, onAnimateChange,
}: Pick<AppTopBarProps,
  'branchPreparing' | 'branchProgress' | 'showBranch' | 'simState'
  | 'animateBranchTurns' | 'branchDivergence' | 'onCancelPreparation' | 'onAnimateChange'>) {
  return (
    <>
      {branchPreparing && (
        <>
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fd6' }}>
            Preparing branch...
            {branchProgress ? ` (turn ${branchProgress.turn}/${branchProgress.target})` : ''}
          </span>
          <button
            type="button"
            className="ps-btn"
            onClick={onCancelPreparation}
            style={{ padding: '2px 8px', fontSize: 10 }}
          >
            Cancel
          </button>
        </>
      )}
      {showBranch && !branchPreparing && (
        <>
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
            Branching · Turn {simState?.turnNumber ?? '…'}
          </span>
          {simState?.ended && (
            <span className="ps-ended-tag">
              {simState.winner ? `${simState.winner} wins!` : 'Ended'}
            </span>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
            <input
              type="checkbox"
              checked={animateBranchTurns}
              onChange={event => onAnimateChange(event.target.checked)}
            />
            Animate branch turns
          </label>
          {branchDivergence && (
            <span
              style={{ fontSize: 10, color: '#e6b36a', maxWidth: 520 }}
              title={branchDivergence}
            >
              ⚠ {branchDivergence}
            </span>
          )}
        </>
      )}
    </>
  );
}

/** Match info + branch status collapsed into one bar above the iframe. */
export function AppTopBar(props: AppTopBarProps) {
  const { replayData, usageStats, setAssumptions, onEditSide, onOpenSets } = props;
  return (
    <div className="ps-topbar">
      <TopBarMatchInfo replayData={replayData} usageStats={usageStats} setAssumptions={setAssumptions} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <TopBarBranchStatus
          branchPreparing={props.branchPreparing}
          branchProgress={props.branchProgress}
          showBranch={props.showBranch}
          simState={props.simState}
          animateBranchTurns={props.animateBranchTurns}
          branchDivergence={props.branchDivergence}
          onCancelPreparation={props.onCancelPreparation}
          onAnimateChange={props.onAnimateChange}
        />
        <button
          type="button"
          onClick={() => onEditSide('p1')}
          className="ps-btn"
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Edit Player
        </button>
        <button
          type="button"
          onClick={() => onEditSide('p2')}
          className="ps-btn"
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Edit Opp
        </button>
        <button
          type="button"
          onClick={() => onOpenSets()}
          className="ps-btn"
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Import/Export Sets
        </button>
      </div>
    </div>
  );
}
