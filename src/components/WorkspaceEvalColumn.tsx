import { EvalPanel } from './EvalPanel';
import { PlayOutBar } from './PlayOutBar';
import { BattleStatsPanel } from './BattleStatsPanel';
import type { AppController } from '../hooks/useAppController';
import type { ReplayData } from '@fulllifegames/replay-core';

interface WorkspaceColumnProps {
  app: AppController;
  replayData: ReplayData;
}

/** The analysis-mode prop block: hidden while the live evaluation view owns the panel. */
function analysisPropsFor(liveEvalView: boolean, analysisTurn: number | null, analysis: AppController['analysis']) {
  return {
    analysis: !liveEvalView ? analysis.turnAnalysis : null,
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
    thinkDeeperTarget, handleThinkDeeper,
  } = app.engine.evalView;
  const { handleExploreChoice, handlePickPair } = app.engine.walk;
  const { playOut } = app.transients;
  return (
    <EvalPanel
      playerNames={[replayData.players[0], replayData.players[1]]}
      status={liveEvalView ? liveEvalStatus : 'idle'}
      result={analyzedResult}
      resultSettings={analyzedSettings}
      onThinkDeeper={!liveEvalView ? handleThinkDeeper : undefined}
      thinkDeeperTarget={!liveEvalView ? thinkDeeperTarget : null}
      smogonPending={app.engine.smogonPending}
      progress={evaluation.progress}
      reconstructProgress={evaluation.reconstructProgress}
      error={evaluation.error}
      prefs={evaluation.prefs}
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
      playOutProgress={playOut?.active ? { startTurn: playOut.startTurn, turns: playOut.turns, atTurn: liveSimTurn } : null}
      graphMaxTurn={analyzableTurns}
      analysisTurn={analysisTurn}
      onSelectTurn={handleGraphSelectLine}
      currentTurn={viewTurn}
      currentLine={viewingVariation ? 'variation' : 'main'}
      variation={variationSpan ? { startTurn: variationSpan.startTurn, scores: variationScores } : null}
      {...analysisPropsFor(liveEvalView, analysisTurn, app.analysis)}
      doubles={replayGameType === 'doubles'}
    />
  );
}

/** Right column: evaluation beside the battle (chess-style), then stats. */
export function WorkspaceEvalColumn({ app, replayData }: WorkspaceColumnProps) {
  const { evalAvailable } = app.engine.evalView;
  const { playOut, playOutNotice } = app.transients;
  const { viewTurn, variationSpan } = app.board.timeline;
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
          viewTurn={viewTurn}
          startDisabled={branchPreparing || usageStats.loading || setAssumptions.loading}
          onStartPlayOut={startPlayOut}
          onStopPlayOut={stopPlayOut}
          onWatchFrom={watchFrom}
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
