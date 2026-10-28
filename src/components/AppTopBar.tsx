import type { BranchSimState } from '../hooks/useBranch';
import { SetupMenu } from './SetupMenu';
import { SupportLinks } from './SupportLinks';

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
  /** A host site frames the app (round 77: the creator link is left out). */
  embed: boolean;
  onReportIssue: () => void;
}

function TopBarMatchInfo({ replayData, usageStats, setAssumptions }: Pick<AppTopBarProps, 'replayData' | 'usageStats' | 'setAssumptions'>) {
  return (
    <div className="ps-topbar-match" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
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
  branchPreparing, branchProgress, showBranch, simState, branchDivergence, onCancelPreparation,
}: Pick<AppTopBarProps, 'branchPreparing' | 'branchProgress' | 'showBranch' | 'simState' | 'branchDivergence' | 'onCancelPreparation'>) {
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
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf', whiteSpace: 'nowrap' }}>
            Branching · Turn {simState?.turnNumber ?? '…'}
          </span>
          {branchDivergence && (
            <span className="ps-topbar-divergence" title={branchDivergence}>
              ⚠ {branchDivergence}
            </span>
          )}
        </>
      )}
    </>
  );
}

/**
 * Match info, branch status, the Setup menu and the support links in one row above the iframe (round 77,
 * user request 28.10.2026: the winner moved to the branch panel, the toggle and the team actions into Setup).
 */
export function AppTopBar(props: AppTopBarProps) {
  const { replayData, usageStats, setAssumptions } = props;
  return (
    <div className="ps-topbar">
      <TopBarMatchInfo replayData={replayData} usageStats={usageStats} setAssumptions={setAssumptions} />
      <div className="ps-topbar-actions">
        <TopBarBranchStatus
          branchPreparing={props.branchPreparing}
          branchProgress={props.branchProgress}
          showBranch={props.showBranch}
          simState={props.simState}
          branchDivergence={props.branchDivergence}
          onCancelPreparation={props.onCancelPreparation}
        />
        <SetupMenu
          animateBranchTurns={props.animateBranchTurns}
          onAnimateChange={props.onAnimateChange}
          onEditSide={props.onEditSide}
          onOpenSets={props.onOpenSets}
        />
      </div>
      <SupportLinks embed={props.embed} withName onReportIssue={props.onReportIssue} />
    </div>
  );
}
