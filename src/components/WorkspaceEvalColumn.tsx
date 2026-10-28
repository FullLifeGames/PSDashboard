import { useMemo } from 'react';
import { EvalPanel } from './EvalPanel';
import { PlayOutBar } from './PlayOutBar';
import { BattleStatsPanel } from './BattleStatsPanel';
import type { AppController } from '../hooks/useAppController';
import { variationBoardShares } from '../lib/variation-shares';
import type { ReplayData } from '@fulllifegames/replay-core';

interface WorkspaceColumnProps {
  app: AppController;
  replayData: ReplayData;
}

/** The analysis-mode prop block: hidden while the live evaluation view owns the panel. */
function analysisPropsFor(liveEvalView: boolean, analysisTurn: number | null, analysis: AppController['analysis']) {
  return {
    analysis: !liveEvalView ? analysis.turnAnalysis : null,
    faintedShares: analysis.faintedShares,
    reads: !liveEvalView ? analysis.turnReads : null,
    leadAnalysis: !liveEvalView && analysisTurn === 0 ? analysis.leadAnalysisData : null,
    reportLeads: analysis.leadAnalysisData,
    report: !liveEvalView ? analysis.gameReport : null,
  };
}

function EvalSection({ app, replayData }: WorkspaceColumnProps) {
  const { evaluation } = app.ctx;
  const { replayGen, replayGameType } = app.ctx.meta;
  const { liveEvalStatus } = app.board;
  const {
    viewTurn, viewingVariation, liveEvalView, liveSimTurn, analyzableTurns, analysisTurn,
    handleGraphSelectLine, variationSpan, variationScores,
  } = app.board.timeline;
  const {
    handleEvaluate, handleAnalyzeGame, analyzedResult, analyzedSettings,
    analyzeTarget, handleAnalyzeTurn,
  } = app.engine.evalView;
  const { handleExploreChoice, handlePickPair } = app.engine.walk;
  const { playOut, fastPlayOut } = app.transients;
  // Round 70 (T216): the gold points and the panel's bar print at the share of the variation's own board, read from the
  // rosters the branch recorded after each executed turn; the main line's share of the same turn number is another board.
  const { history } = app.ctx.branch;
  const variationShares = useMemo(
    () => (variationSpan ? variationBoardShares(history, variationSpan.startTurn) : []),
    [history, variationSpan],
  );
  return (
    <EvalPanel
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
      onCancel={evaluation.cancel}
      onPickChoice={handleExploreChoice}
      onPickPair={handlePickPair}
      showAuto={liveEvalView}
      showTera={replayGen === 9}
      graph={evaluation.graph}
      onAnalyzeGame={handleAnalyzeGame}
      positionLabel={liveEvalView ? `Turn ${viewTurn} · ${viewingVariation ? 'variation' : 'main line'}` : null}
      playOutProgress={playOut?.active ? { startTurn: playOut.startTurn, turns: playOut.turns, atTurn: liveSimTurn, fast: fastPlayOut } : null}
      graphMaxTurn={analyzableTurns}
      analysisTurn={analysisTurn}
      onSelectTurn={handleGraphSelectLine}
      currentTurn={viewTurn}
      currentLine={viewingVariation ? 'variation' : 'main'}
      variation={variationSpan ? { startTurn: variationSpan.startTurn, scores: variationScores, shares: variationShares } : null}
      {...analysisPropsFor(liveEvalView, analysisTurn, app.analysis)}
      doubles={replayGameType === 'doubles'}
    />
  );
}

/** Right column: evaluation beside the battle (chess-style), then stats. */
export function WorkspaceEvalColumn({ app, replayData }: WorkspaceColumnProps) {
  const { evalAvailable } = app.engine.evalView;
  const { playOut, playOutNotice, fastPlayOut, setFastPlayOut } = app.transients;
  const { viewTurn, variationSpan, viewingVariation, atEndPosition, atVariationEnd } = app.board.timeline;
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
