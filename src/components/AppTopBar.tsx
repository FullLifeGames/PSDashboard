import type { BranchSimState } from '../hooks/useBranch';
import { LoaderMenu } from './LoaderMenu';
import { MatchTitle } from './MatchTitle';
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
  opponentReads: boolean;
  onOpponentReadsChange: (value: boolean) => void;
  onEditSide: (side: 'p1' | 'p2') => void;
  onOpenSets: () => void;
  search?: Parameters<typeof SetupMenu>[0]['search'];
  /** A host site frames the app: the creator link is left out. */
  embed: boolean;
  /** The replay loader's props; the embedded view keeps no loader. */
  loader?: Parameters<typeof LoaderMenu>[0];
  onReportIssue: () => void;
  newGame?: boolean;
}

function TopBarMatchInfo({ replayData, usageStats, setAssumptions, newGame }: Pick<AppTopBarProps, 'replayData' | 'usageStats' | 'setAssumptions' | 'newGame'>) {
  return (
    <div className="ps-topbar-match" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <MatchTitle format={replayData.format} players={replayData.players} newGame={newGame} />
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
            Variation tip: Turn {simState?.turnNumber ?? '…'}
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

export function AppTopBar(props: AppTopBarProps) {
  const { replayData, usageStats, setAssumptions } = props;
  return (
    <div className="ps-topbar">
      <TopBarMatchInfo replayData={replayData} usageStats={usageStats} setAssumptions={setAssumptions} newGame={props.newGame} />
      <div className="ps-topbar-actions">
        <TopBarBranchStatus
          branchPreparing={props.branchPreparing}
          branchProgress={props.branchProgress}
          showBranch={props.showBranch}
          simState={props.simState}
          branchDivergence={props.branchDivergence}
          onCancelPreparation={props.onCancelPreparation}
        />
        {props.loader && <LoaderMenu {...props.loader} />}
        <SetupMenu
          animateBranchTurns={props.animateBranchTurns}
          onAnimateChange={props.onAnimateChange}
          opponentReads={props.opponentReads}
          onOpponentReadsChange={props.onOpponentReadsChange}
          onEditSide={props.onEditSide}
          onOpenSets={props.onOpenSets}
          search={props.search}
        />
      </div>
      <SupportLinks embed={props.embed} withName onReportIssue={props.onReportIssue} />
    </div>
  );
}
