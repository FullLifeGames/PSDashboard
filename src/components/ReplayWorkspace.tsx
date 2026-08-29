import { PSReplayFrame } from './PSReplayFrame';
import { BranchPanel } from './BranchPanel';
import { LeadPanel } from './LeadPanel';
import { BranchHistoryPanel } from './BranchHistoryPanel';
import { BranchSaveSharePanel } from './BranchSaveSharePanel';
import { ReplayLoader } from './ReplayLoader';
import { AppTopBar } from './AppTopBar';
import { TimelineBar } from './TimelineBar';
import { ConfirmBanner } from './ConfirmBanner';
import { WorkspaceEvalColumn } from './WorkspaceEvalColumn';
import type { AppController } from '../hooks/useAppController';
import type { ReplayData } from '../types';

interface WorkspaceProps {
  app: AppController;
  replayData: ReplayData;
}

function WorkspaceTopBar({ app, replayData }: WorkspaceProps) {
  const { branchPreparing, branchProgress, cancelPreparation, branchDivergence } = app.board.deviation;
  const { setEditorSide, setSetsPanelOpen } = app.ctx.knowledge;
  return (
    <AppTopBar
      replayData={replayData}
      usageStats={app.ctx.smogon.usageStats}
      setAssumptions={app.ctx.smogon.setAssumptions}
      branchPreparing={branchPreparing}
      branchProgress={branchProgress}
      showBranch={app.analysis.showBranch}
      simState={app.ctx.branch.simState}
      animateBranchTurns={app.ctx.animateBranchTurns}
      branchDivergence={branchDivergence}
      onCancelPreparation={cancelPreparation}
      onAnimateChange={app.ctx.setAnimateBranchTurns}
      onEditSide={setEditorSide}
      onOpenSets={() => setSetsPanelOpen(true)}
    />
  );
}

function BattleFrame({ app, replayData }: WorkspaceProps) {
  const { showBranch, simLog, latestBranchHistoryEntry, branchReloadKey } = app.analysis;
  const { viewingVariation, viewTurn, viewT0, navSeek, handleReplayTurn } = app.board.timeline;
  const { playOut } = app.transients;
  return (
    <div className="ps-iframe-wrap">
      {showBranch && viewingVariation ? (
        <PSReplayFrame
          key="branch"
          log={simLog}
          format={replayData.format}
          p1={replayData.players[0]}
          p2={replayData.players[1]}
          title="Branch Simulation"
          height={480}
          seekTurn={viewTurn}
          autoPlay={false}
          viewpoint={replayData.viewpoint}
          liveUpdates
          liveAppendMode={playOut?.active ? 'hold' : app.ctx.animateBranchTurns ? 'play' : 'follow-end'}
          liveAppendTurn={latestBranchHistoryEntry?.turnNumber ?? null}
          reloadKey={branchReloadKey}
          seekRequest={navSeek}
        />
      ) : (
        <PSReplayFrame
          key="replay"
          log={replayData.log}
          format={replayData.format}
          p1={replayData.players[0]}
          p2={replayData.players[1]}
          height={480}
          seekTurn={viewT0 ? 0 : viewTurn}
          autoPlay={false}
          viewpoint={replayData.viewpoint}
          reloadKey={`${replayData.id}:original`}
          onTurnChange={handleReplayTurn}
        />
      )}
    </div>
  );
}

function LeadRegion({ app, replayData }: WorkspaceProps) {
  const { variationSpan } = app.board.timeline;
  const { executing, history } = app.ctx.branch;
  const { branchPreparing, leadOptions, startLeadVariation } = app.board.deviation;
  const { replayGameType, bringCount } = app.ctx.meta;
  return (
    <LeadPanel
      key={`${replayData.id}:${leadOptions.p1.length}`}
      playerNames={[replayData.players[0], replayData.players[1]]}
      p1Options={leadOptions.p1}
      p2Options={leadOptions.p2}
      leadsPerSide={replayGameType === 'doubles' ? 2 : 1}
      bringCount={bringCount}
      pickedLeads={variationSpan?.startTurn === 0 ? history[0]?.leadChoices ?? null : null}
      executing={executing || branchPreparing}
      onStart={leads => startLeadVariation(bringCount !== null ? { ...leads, bring: true } : leads)}
    />
  );
}

/* Variant B: the pickers are ALWAYS there — live sim state at the
   tip, resolved picker state (stored/snapshot) everywhere else.
   On T0 the lead picker takes their place. */
function PickerRegion({ app, replayData }: WorkspaceProps) {
  const { playOut } = app.transients;
  const { viewT0, viewTurn, liveTip } = app.board.timeline;
  const { simState, executing, executeError } = app.ctx.branch;
  const { branchPreparing, handleSetChoice, handleExecuteDraft } = app.board.deviation;
  const { replayGen } = app.ctx.meta;
  const { positionPicker, pickerSimState, playedAtView } = app.engine;
  if (playOut?.active) {
    /* A steady stand-in while the engine plays: the per-turn picker
       churn was the "everything keeps switching" complaint, and a
       click here mid-run would corrupt the loop anyway. */
    return (
      <div className="ps-panel" role="status" style={{ fontSize: 11, color: '#aabbcc' }}>
        <span className="ps-spinner" aria-hidden="true" />{' '}
        The engine is picking both sides&rsquo; moves — the pickers come back when it stops.
      </div>
    );
  }
  if (viewT0) {
    return <LeadRegion app={app} replayData={replayData} />;
  }
  return (
    <BranchPanel
      simState={liveTip ? simState : pickerSimState}
      source={liveTip ? 'live' : positionPicker?.source}
      acquiringExact={!liveTip && app.engine.acquire.exactAcquiringTurn === viewTurn}
      executeError={executeError}
      executing={executing || branchPreparing}
      gen={replayGen}
      onSetChoice={handleSetChoice}
      onHypotheticalMove={app.handleHypotheticalMove}
      onExecuteTurn={liveTip ? app.handleExecuteTurn : handleExecuteDraft}
      played={playedAtView}
    />
  );
}

function BranchSidePanels({ app, replayData }: WorkspaceProps) {
  const { viewTurn, viewingVariation, variationSpan, navigateTo } = app.board.timeline;
  const { history } = app.ctx.branch;
  const { snapshots } = app.ctx.replay;
  return (
    <>
      <BranchHistoryPanel
        branchStartTurn={variationSpan?.startTurn ?? viewTurn}
        history={history}
        snapshots={snapshots}
        currentPosition={{ turn: viewTurn, line: viewingVariation ? 'variation' : 'main' }}
        onNavigate={navigateTo}
      />
      <BranchSaveSharePanel
        replayData={replayData}
        branchTurn={variationSpan?.startTurn ?? viewTurn}
        history={history}
        finalLog={app.analysis.simLog}
      />
    </>
  );
}

function WorkspaceLeft({ app, replayData }: WorkspaceProps) {
  const { branchDivergence } = app.board.deviation;
  const { pendingConfirm, setPendingConfirm, setPlayOut } = app.transients;
  const { variationSpan } = app.board.timeline;
  const { branching } = app.ctx.branch;
  const { loading, error, embed, loadReplay, loadReplayFile, loadedReplayUrl } = app.ctx.replay;
  const { handleTeamLoad, teamPasteStatus, teamPasteError } = app.ctx.knowledge;
  return (
    <div className="ps-main-left">
      {/* Match info + loader collapsed into one bar */}
      <WorkspaceTopBar app={app} replayData={replayData} />
      {/* Single iframe */}
      <BattleFrame app={app} replayData={replayData} />
      {/* Timeline bar: always visible — one slider over main line and variation */}
      <TimelineBar
        viewT0={app.board.timeline.viewT0}
        viewTurn={app.board.timeline.viewTurn}
        viewLine={app.board.timeline.viewLine}
        variationSpan={variationSpan}
        maxTurn={app.board.timeline.maxTurn}
        endSnapshotTurn={app.board.timeline.endSnapshotTurn}
        atEndPosition={app.board.timeline.atEndPosition}
        viewingVariation={app.board.timeline.viewingVariation}
        branching={branching}
        onNavigate={app.board.timeline.navigateTo}
        onGraphSelectLine={app.board.timeline.handleGraphSelectLine}
        onDiscard={app.board.discardVariation}
      />
      {branchDivergence && !app.analysis.showBranch && (
        <div className="ps-panel" role="alert" style={{ marginTop: 6, padding: '6px 10px', fontSize: 11, color: '#e6b36a' }}>
          ⚠ {branchDivergence}
        </div>
      )}
      {pendingConfirm && (
        <ConfirmBanner
          message={pendingConfirm.message}
          onProceed={pendingConfirm.proceed}
          onCancel={() => { setPendingConfirm(null); app.engine.walk.clearPendingPick(); setPlayOut(null); }}
        />
      )}
      <PickerRegion app={app} replayData={replayData} />
      {(branching || variationSpan !== null) && <BranchSidePanels app={app} replayData={replayData} />}
      {!embed && (
        <ReplayLoader
          onLoad={loadReplay}
          onLoadFile={loadReplayFile}
          onTeamLoad={handleTeamLoad}
          loading={loading}
          error={error}
          loadedUrl={loadedReplayUrl}
          teamStatus={teamPasteStatus}
          teamError={teamPasteError}
        />
      )}
    </div>
  );
}

/** The loaded-replay layout: battle iframe and panels beside the evaluation column. */
export function ReplayWorkspace({ app, replayData }: WorkspaceProps) {
  return (
    <div className="ps-main-layout">
      {/* Left column: iframe */}
      <WorkspaceLeft app={app} replayData={replayData} />
      {/* Right column: evaluation beside the battle (chess-style), then stats */}
      <WorkspaceEvalColumn app={app} replayData={replayData} />
    </div>
  );
}
