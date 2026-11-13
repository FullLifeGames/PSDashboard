import { PSReplayFrame } from './PSReplayFrame';
import { isGameId } from '../lib/new-game/record';
import { DockRegion } from './dock/DockRegion';
import { LeadPanel } from './LeadPanel';
import { BranchHistoryPanel } from './BranchHistoryPanel';
import { useBranchSaveShare } from './useBranchSaveShare';
import { AppTopBar } from './AppTopBar';
import { TimelineBar } from './TimelineBar';
import { ConfirmBanner } from './ConfirmBanner';
import { useLayoutHeight } from '../hooks/useLayoutHeight';
import { WorkspaceEvalColumn } from './WorkspaceEvalColumn';
import type { AppController } from '../hooks/useAppController';
import { useCallback, useMemo, useState } from 'react';
import type { FrameSide } from '../hooks/useReplayFrame';
import { logRules, type ReplayData } from '@fulllifegames/replay-core';
import { ReplayRulesContext } from '../lib/replay-rules';
import { GuessedBodiesContext, guessedBodies } from '../lib/stand-in-mark';
import { REPLAY_FRAME_HEIGHT } from '../lib/replay-html';

interface WorkspaceProps {
  app: AppController;
  replayData: ReplayData;
  /** Round 89 (#105): opens the New game dialog (an item of the Load menu). */
  onNewGame?: () => void;
}

function WorkspaceTopBar({ app, replayData, onNewGame }: WorkspaceProps) {
  const { branchPreparing, branchProgress, cancelPreparation, branchDivergence } = app.board.deviation;
  const { setEditorSide, setSetsPanelOpen, handleTeamLoad, teamPasteStatus, teamPasteError } = app.ctx.knowledge;
  const { loading, error, embed, loadReplay, loadReplayFile, loadedReplayUrl } = app.ctx.replay;
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
      embed={embed}
      // Round 84 (Q20 a): with a replay loaded the loader is the top bar's Load button; the embedded view keeps none.
      loader={embed ? undefined : {
        onLoad: loadReplay,
        onLoadFile: loadReplayFile,
        onTeamLoad: handleTeamLoad,
        loading,
        error,
        loadedUrl: loadedReplayUrl,
        teamStatus: teamPasteStatus,
        teamError: teamPasteError,
        onNewGame,
      }}
      newGame={isGameId(replayData.id)}
      onReportIssue={app.support.reportIssue}
    />
  );
}

/**
 * Round 88 (T316): names the frame the workspace shows: the main line's frame, or the branch's for one session of the variation.
 * The replay's id and viewpoint are part of it, so a new document of the same replay (a link with ?p2) starts a new report.
 */
function frameIdentity(app: AppController, replayData: ReplayData): string {
  const base = `${replayData.id}:${replayData.viewpoint ?? 'p1'}`;
  return app.analysis.showBranch && app.board.timeline.viewingVariation ? `${base}:branch:${app.analysis.branchReloadKey}` : `${base}:replay`;
}

/**
 * Round 88 (T316): the side the frame shows near, for the dock. The frame's document reports it (Switch sides, the ?p2 flag); until
 * its first report, and for a frame that mounted after the last report (the swap between the main and the branch frame, a new
 * branch session, a new replay), it is the replay's viewpoint. A report belongs to the frame that sent it; the identity changing
 * drops it during render, as state that follows a prop is reconciled.
 */
function useNearSide(identity: string, viewpoint: FrameSide | undefined) {
  const [report, setReport] = useState<{ frame: string; side: FrameSide | null }>({ frame: identity, side: null });
  if (report.frame !== identity) setReport({ frame: identity, side: null });
  const onSideChange = useCallback((side: FrameSide) => setReport({ frame: identity, side }), [identity]);
  return { nearSide: (report.frame === identity ? report.side : null) ?? viewpoint ?? 'p1', onSideChange };
}

function BattleFrame({ app, replayData, onSideChange }: WorkspaceProps & { onSideChange: (side: FrameSide) => void }) {
  const { showBranch, simLog, latestBranchHistoryEntry, branchReloadKey } = app.analysis;
  const { viewingVariation, viewTurn, viewT0, navSeek, handleReplayTurn, followedPlay, tipTurn } = app.board.timeline;
  const { playOut } = app.transients;
  const appendMode = playOut?.active ? 'hold' : app.ctx.animateBranchTurns ? 'play' : 'follow-end';
  // The pointer followed a turn that just ran: a branch frame that opens now plays that turn in.
  const openAtTurn = appendMode === 'play' && followedPlay && tipTurn !== null && viewTurn === tipTurn ? tipTurn - 1 : null;
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
          height={REPLAY_FRAME_HEIGHT}
          seekTurn={viewTurn}
          autoPlay={false}
          viewpoint={replayData.viewpoint}
          liveUpdates
          liveAppendMode={appendMode}
          liveAppendTurn={latestBranchHistoryEntry?.turnNumber ?? null}
          openAtTurn={openAtTurn}
          reloadKey={branchReloadKey}
          seekRequest={navSeek}
          onTurnChange={handleReplayTurn}
          onSideChange={onSideChange}
          choosers={false}
        />
      ) : (
        <PSReplayFrame
          key="replay"
          log={replayData.log}
          format={replayData.format}
          p1={replayData.players[0]}
          p2={replayData.players[1]}
          height={REPLAY_FRAME_HEIGHT}
          seekTurn={viewT0 ? 0 : viewTurn}
          autoPlay={false}
          viewpoint={replayData.viewpoint}
          reloadKey={mainFrameKey(replayData)}
          onTurnChange={handleReplayTurn}
          onSideChange={onSideChange}
          choosers={false}
        />
      )}
    </div>
  );
}

/** The main frame's document key. A new game's log grows with every promoted turn, so its frame opens again on the longer log (round 89, #105); a replay's log never changes. */
const mainFrameKey = (replayData: { id: string; log: string }) =>
  isGameId(replayData.id) ? `${replayData.id}:original:${replayData.log.length}` : `${replayData.id}:original`;

function LeadRegion({ app, replayData, nearSide }: WorkspaceProps & { nearSide: FrameSide }) {
  const { variationSpan } = app.board.timeline;
  const { executing, history } = app.ctx.branch;
  const { branchPreparing, leadOptions, startLeadVariation } = app.board.deviation;
  const { replayGameType, bringCount } = app.ctx.meta;
  const { setLeadPicks } = app.transients;
  // One reading of the picks for both buttons: a bring-limited format carries its back line along.
  const withBring = (leads: { p1: string[]; p2: string[] }) => (bringCount !== null ? { ...leads, bring: true } : leads);
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
      onStart={leads => startLeadVariation(withBring(leads))}
      onPicksChange={picks => setLeadPicks(picks && withBring(picks))}
      nearSide={nearSide}
    />
  );
}

/** The lead picker of turn 0 and the confirm banner above it (the dock's place at turn 0); the dock region takes over everywhere else. */
function LeadSlot({ app, replayData, nearSide }: WorkspaceProps & { nearSide: FrameSide }) {
  const { pendingConfirm, setPendingConfirm, playOut } = app.transients;
  if (!app.board.timeline.viewT0 || playOut?.active) return null;
  return (
    <>
      {pendingConfirm && (
        <ConfirmBanner
          message={pendingConfirm.message}
          onProceed={pendingConfirm.proceed}
          onCancel={() => { setPendingConfirm(null); app.engine.walk.clearPendingPick(); }}
        />
      )}
      <LeadRegion app={app} replayData={replayData} nearSide={nearSide} />
    </>
  );
}

function BranchSidePanels({ app, replayData }: WorkspaceProps) {
  const { viewTurn, viewingVariation, variationSpan, navigateTo } = app.board.timeline;
  const { history } = app.ctx.branch;
  const { snapshots } = app.ctx.replay;
  const branchStartTurn = variationSpan?.startTurn ?? viewTurn;
  const slots = useBranchSaveShare({ replayData, branchTurn: branchStartTurn, history, finalLog: app.analysis.simLog });
  return (
    <BranchHistoryPanel
      key={branchStartTurn}
      branchStartTurn={branchStartTurn}
      history={history}
      snapshots={snapshots}
      currentPosition={{ turn: viewTurn, line: viewingVariation ? 'variation' : 'main' }}
      onNavigate={navigateTo}
      ended={app.ctx.branch.simState?.ended ?? false}
      slots={slots}
    />
  );
}

function WorkspaceAlert({ text }: { text: string }) {
  return (
    <div className="ps-panel" role="alert" style={{ marginTop: 6, padding: '6px 10px', fontSize: 11, color: '#e6b36a' }}>
      {text}
    </div>
  );
}

function WorkspaceLeft({ app, replayData, onNewGame }: WorkspaceProps) {
  const { branchDivergence, variationNotice } = app.board.deviation;
  const { variationSpan } = app.board.timeline;
  const { branching } = app.ctx.branch;
  const { nearSide, onSideChange } = useNearSide(frameIdentity(app, replayData), replayData.viewpoint);
  return (
    <div className="ps-main-left">
      {/* Match info, the Load and Setup menus in one bar */}
      <WorkspaceTopBar app={app} replayData={replayData} onNewGame={onNewGame} />
      {/* Single iframe */}
      <BattleFrame app={app} replayData={replayData} onSideChange={onSideChange} />
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
        variationEnded={app.ctx.branch.simState?.ended ?? false}
        branching={branching}
        onNavigate={app.board.timeline.navigateTo}
        onGraphSelectLine={app.board.timeline.handleGraphSelectLine}
        onDiscard={app.board.discardVariation}
      />
      {branchDivergence && !app.analysis.showBranch && <WorkspaceAlert text={`⚠ ${branchDivergence}`} />}
      {variationNotice && <WorkspaceAlert text={variationNotice} />}
      {(branching || variationSpan !== null) && <BranchSidePanels app={app} replayData={replayData} />}
      {/* Round 84 (A7b): at turn 0 the lead picker stands where the dock stands, as the column's last child. */}
      <LeadSlot app={app} replayData={replayData} nearSide={nearSide} />
      <DockRegion app={app} replayId={replayData.id} nearSide={nearSide} />
    </div>
  );
}

/** The loaded-replay layout: battle iframe and panels beside the evaluation column. */
export function ReplayWorkspace({ app, replayData, onNewGame }: WorkspaceProps) {
  const rules = useMemo(() => logRules(replayData.log), [replayData]);
  // Round 88 (F, #101): the bodies the log never showed wear the stats panel's marker wherever the What-if offers them.
  const { statsP1Info, statsP2Info } = app.ctx.knowledge;
  // Round 89 (#124): a short-side game's heaviest world guesses the bodies its side never fielded; they wear a mark of their own.
  const { bringWorlds } = app.ctx.meta;
  const isGuessed = useMemo(() => guessedBodies(statsP1Info, statsP2Info, rules, bringWorlds), [statsP1Info, statsP2Info, rules, bringWorlds]);
  // Round 84 (A7b, ruling 9a): the layout's height caps the left column; the right column follows the dock's foot.
  const layoutRef = useLayoutHeight();
  return (
    <ReplayRulesContext.Provider value={rules}>
      <GuessedBodiesContext.Provider value={isGuessed}>
        <div className="ps-main-layout" ref={layoutRef}>
          {/* Left column: iframe */}
          <WorkspaceLeft app={app} replayData={replayData} onNewGame={onNewGame} />
          {/* Right column: evaluation beside the battle (chess-style), then stats */}
          <WorkspaceEvalColumn app={app} replayData={replayData} />
        </div>
      </GuessedBodiesContext.Provider>
    </ReplayRulesContext.Provider>
  );
}
