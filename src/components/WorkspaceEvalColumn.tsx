import { useMemo } from 'react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import type { EvalStatus, StoppedRun } from '../hooks/useEvaluation';
import { stoppedEmptyHere } from '../lib/stopped-line';
import { EvalPanel } from './EvalPanel';
import { PlayOutBar } from './PlayOutBar';
import { resultPositionLabel } from './eval/turn-copy';
import { BattleStatsPanel } from './BattleStatsPanel';
import type { AppController } from '../hooks/useAppController';
import { gameTipTurn } from '../hooks/useNewGame';
import { idleTip } from './game-tip';
import { variationBoardShares } from '../lib/variation-shares';
import type { ReplayData } from '@fulllifegames/replay-core';
import { useLinesHost } from '../hooks/usePlayLine';
import { mainLineTarget } from './timeline-target';

interface WorkspaceColumnProps {
  app: AppController;
  replayData: ReplayData;
}

function analysisPropsFor(liveEvalView: boolean, analysisTurn: number | null, analysis: AppController['analysis']) {
  return {
    analysis: !liveEvalView ? analysis.turnAnalysis : null,
    faintedShares: analysis.faintedShares,
    reads: !liveEvalView ? analysis.turnReads : null,
    leadAnalysis: !liveEvalView && analysisTurn === 0 ? analysis.leadAnalysisData : null,
    reportLeads: analysis.leadAnalysisData,
    report: !liveEvalView ? analysis.gameReport : null,
    reviewAnalyses: !liveEvalView ? analysis.gameAnalyses : null,
  };
}

/**
 * A live result that still streams in for a position the pointer left maps its choices onto the wrong position: the lines stay
 * readable and stop being buttons until the position on screen has its own result.
 */
const linesClickable = (liveEvalView: boolean, evalResultMatchesView: boolean) => !liveEvalView || evalResultMatchesView;

const endedFor = (atVariationEnd: boolean, simState: AppController['ctx']['branch']['simState']) =>
  (atVariationEnd ? { winner: simState?.winner ?? null } : null);

/** A game's tip turn that waits for its replacement is the main line's next turn: no gold line, no "variation" in the card's tag. */
function idleReads(app: AppController, viewingVariation: boolean, resultTag: string | null) {
  const idle = idleTip(app);
  return { idle, viewingVariation: viewingVariation && !idle, resultTag: idle ? resultTag?.replace(/^variation:/, 'main:') ?? null : resultTag };
}

/**
 * The gold points and the panel's bar print at the share of the variation's own board, read from the rosters recorded after each
 * executed turn; the main line's share of the same turn number is another board.
 */
function useVariationShares(history: AppController['ctx']['branch']['history'], variationSpan: { startTurn: number } | null) {
  return useMemo(() => (variationSpan ? variationBoardShares(history, variationSpan.startTurn) : []), [history, variationSpan]);
}

/** A line started from a turn card (`cardTurn`) goes back to that turn, whichever turn the variation reached. */
function backToMain(app: AppController, viewingVariation: boolean): ((cardTurn: number | null) => void) | undefined {
  if (!viewingVariation || !app.analysis.gameReport) return undefined;
  const { viewTurn, maxTurn, navigateTo } = app.board.timeline;
  return cardTurn => navigateTo(cardTurn === null ? mainLineTarget(viewTurn, maxTurn) : mainLineTarget(cardTurn, maxTurn));
}

/** The depth of the partial result a user stop kept, while that result is the live position's; null otherwise. */
function stoppedDepth(stopped: StoppedRun | null, shown: { live: boolean; status: EvalStatus; matches: boolean }, result: EvalResult | null): number | null {
  return stopped && shown.live && shown.status === 'stale' && shown.matches ? result?.depthCompleted ?? 1 : null;
}

function EvalSection({ app, replayData }: WorkspaceColumnProps) {
  const { evaluation } = app.ctx;
  const { replayGen, replayGameType } = app.ctx.meta;
  const { liveEvalStatus, evalResultMatchesView } = app.board;
  const {
    viewTurn, viewingVariation, liveEvalView, liveSimTurn, analyzableTurns, analysisTurn,
    handleGraphSelectLine, variationSpan, variationScores, atVariationEnd,
  } = app.board.timeline;
  const {
    handleEvaluate, handleAnalyzeGame, analyzedResult, analyzedSettings,
    analyzeTarget, handleAnalyzeTurn,
  } = app.engine.evalView;
  const { handleExploreChoice, handlePickPair } = app.engine.walk;
  const { playOut, fastPlayOut } = app.transients;
  // The rows at T0 rank the leads; a click on one found no live position and opened an empty variation at turn 1.
  const clickable = linesClickable(liveEvalView, evalResultMatchesView) && analysisTurn !== 0;
  const reads = idleReads(app, viewingVariation, evaluation.resultTag);
  const variationShares = useVariationShares(app.ctx.branch.history, variationSpan);
  const linesHost = useLinesHost(app, replayData);
  return (
    <EvalPanel
      linesHost={linesHost}
      playerNames={[replayData.players[0], replayData.players[1]]}
      status={liveEvalView ? liveEvalStatus : 'idle'}
      result={analyzedResult}
      resultSettings={analyzedSettings}
      onAnalyzeTurn={!liveEvalView ? handleAnalyzeTurn : undefined}
      analyzeTarget={!liveEvalView ? analyzeTarget : null}
      smogonPending={app.engine.smogonPending}
      progress={evaluation.progress}
      reconstructProgress={evaluation.reconstructProgress}
      error={evaluation.error}
      prefs={evaluation.prefs}
      engines={app.ctx.engines}
      onPrefsChange={evaluation.setPrefs}
      onEvaluate={liveEvalView ? handleEvaluate : undefined}
      onCancel={evaluation.stop}
      stoppedEmpty={stoppedEmptyHere(evaluation.stopped, { live: liveEvalView, status: liveEvalStatus, key: app.board.timeline.evalViewKey })}
      stoppedAt={stoppedDepth(evaluation.stopped, { live: liveEvalView, status: liveEvalStatus, matches: evalResultMatchesView }, analyzedResult)}
      onPickChoice={clickable ? handleExploreChoice : undefined}
      onPickPair={clickable ? handlePickPair : undefined}
      showAuto={liveEvalView}
      showTera={replayGen === 9}
      graph={evaluation.graph}
      onAnalyzeGame={handleAnalyzeGame}
      ended={endedFor(atVariationEnd, app.ctx.branch.simState)}
      positionLabel={liveEvalView ? resultPositionLabel(reads.resultTag, { viewTurn, viewingVariation: reads.viewingVariation }) : null}
      playOutProgress={playOut?.active ? { startTurn: playOut.startTurn, turns: playOut.turns, atTurn: liveSimTurn, fast: fastPlayOut, stopping: !!playOut.stopping, game: app.ctx.newGame.record !== null } : null}
      graphMaxTurn={analyzableTurns}
      analysisTurn={analysisTurn}
      onSelectTurn={handleGraphSelectLine}
      currentTurn={viewTurn}
      currentLine={reads.viewingVariation ? 'variation' : 'main'}
      variation={variationSpan && !reads.idle ? { startTurn: variationSpan.startTurn, scores: variationScores, shares: variationShares } : null}
      {...analysisPropsFor(liveEvalView, analysisTurn, app.analysis)}
      doubles={replayGameType === 'doubles'}
      openTurn={app.ctx.newGame.record ? gameTipTurn(app.ctx.newGame.record) : null}
      onBackToMain={backToMain(app, reads.viewingVariation)}
    />
  );
}

export function WorkspaceEvalColumn({ app, replayData }: WorkspaceColumnProps) {
  const { evalAvailable } = app.engine.evalView;
  const { playOut, playOutNotice, fastPlayOut, setFastPlayOut } = app.transients;
  const { viewTurn, viewT0, variationSpan, viewingVariation, atEndPosition, atVariationEnd } = app.board.timeline;
  const { branchPreparing } = app.board.deviation;
  const { usageStats, setAssumptions } = app.ctx.smogon;
  const { startPlayOut, stopPlayOut, watchFrom } = app.engine.playOutControls;
  const { statsP1Info, statsP2Info } = app.ctx.knowledge;
  return (
    <div className="ps-main-right">
      {evalAvailable && <EvalSection app={app} replayData={replayData} />}
      {evalAvailable && (
        <PlayOutBar
          playOut={playOut}
          playOutNotice={playOutNotice}
          hasVariation={variationSpan !== null}
          ended={viewingVariation ? atVariationEnd : atEndPosition}
          viewTurn={viewTurn}
          atTurnZero={viewT0}
          startDisabled={branchPreparing || usageStats.loading || setAssumptions.loading}
          fastPlayOut={fastPlayOut}
          onStartPlayOut={startPlayOut}
          onStopPlayOut={stopPlayOut}
          onWatchFrom={watchFrom}
          onFastPlayOutChange={setFastPlayOut}
        />
      )}
      <BattleStatsPanel
        replayData={replayData}
        p1Info={statsP1Info}
        p2Info={statsP2Info}
      />
    </div>
  );
}
