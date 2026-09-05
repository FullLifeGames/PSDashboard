/**
 * Public surface of @fulllifegames/eval-engine. Curated: the names the app, the worker, the
 * sibling package, and the worked example reach, plus every type their
 * signatures mention. Widen it by adding a line here and refreshing
 * regression/fixtures/api/eval-engine.txt (UPDATE_API_SNAPSHOT=1); the
 * suites import package sources directly and never depend on this list.
 */
export {
  analyzeTurn, PAYOFF_WINDOW, REGRET_THRESHOLD, TIER_THRESHOLDS, decidedSeenKey, forcedWinSeenKey, unansweredSeenKey,
  diffChoices, matchPlayedSide, phantomStayIn, playedSetupMove,
} from './analysis.ts';
export type {
  AnalyzeTurnParams, SensitivityProbe, SideAnalysis, TurnAnalysis, TurnAttribution, TurnSensitivity,
  TurnVerification, VerdictTier,
} from './analysis.ts';
export {
  notationSlotChoice, notationSideLabel, switchChoiceKey, switchOptionKey, requiredChoicesForActiveSlots,
  branchSideChoicesReady, evalChoiceToSlotChoices,
} from './branch-choices.ts';
export type { BranchChoiceActive, BranchMoveModifier, BranchSlotChoice } from './branch-choices.ts';
export {
  applyTargetCorrections, reconstructionReached, validateBranchRuntime, correctActivesFromProtocol,
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
  annotateNicknames, executeBranchChoices, resolveSideChoices, reconstructBranchRuntime,
} from './branch-engine.ts';
export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
  ResolvedSideCommand, ReconstructParams,
} from './branch-engine.ts';
export type { BranchChoices } from './branch/types.ts';
export { buildChoiceLockContext } from './choice-lock.ts';
export type { ChoiceLockTrails, ChoiceLockContext } from './choice-lock.ts';
export { calcSingleDamageRange } from './damage-calc.ts';
export type { DamageResult, DamageCalcContext } from './damage-calc.ts';
export { deserializeBattleExact } from './forward-model.ts';
export { ENDGAME_CAPS, endgameScope, solveEndgame } from './endgame/solver.ts';
export type { EndgameCaps, EndgameFlag, EndgameResult } from './endgame/solver.ts';
export { PROVER_BUDGET, proveForcedWin } from './endgame/prover.ts';
export type { ProveRequest, ProverBudget } from './endgame/prover.ts';
export { forcedWinFor } from './search/forced-win.ts';
export { applyForcedWin, forcedWinInput, forcedWinPossible } from './search/forced-win-apply.ts';
export { ENDGAME_MAX_BODIES, MIN_FORCED_MASS, SPOKEN_MASS } from './types.ts';
export { computeBlunders, selectKeyTurns } from './graph.ts';
export { summarizeAlignment } from './hax-alignment.ts';
export type { AlignmentScore, TurnAlignmentRecord, AlignmentSummary } from './hax-alignment.ts';
export { analyzeLeads } from './leads.ts';
export type { LeadSideAnalysis, LeadAnalysis, LeadEvalData } from './leads.ts';
export { mergeMctsTrees, rowCompletedCells, starvedSupportCells, MCTS_TREES } from './mcts-merge.ts';
export { mctsSearch, mctsTreeSearch } from './mcts.ts';
export type { MctsCallbacks } from './mcts.ts';
export { parseTendencies, computeRead } from './opponent-model.ts';
export type { PlayerTendencies } from './opponent-model.ts';
export { searchOrchestrated } from './orchestrator.ts';
export type { SearchExecutor, OrchestratorCallbacks } from './orchestrator.ts';
export { perfReset, perfAdd, perfCount, perfSpan, perfSync, perfReport } from './perf-trace.ts';
export {
  parsePlayedActions, parseLeadSpecies, parsePlayedActionsDoubles, allTurnEvents, detectSacks,
} from './played.ts';
export type { PlayedAction, PlayedTurn, SackInfo } from './played.ts';
export { cellKey } from './rank.ts';
export { buildGameReport } from './report.ts';
export type { GameReport } from './report.ts';
export type { WinConversion, WinPath } from './win-reason.ts';
export { diceEventTurns } from './dice-events.ts';
export type { PairThreat, MatchupCache } from './score/threat.ts';
export { createLocalExecutor, searchPosition } from './search.ts';
export type { SearchCallbacks } from './search/matrix.ts';
export { selectProbeCombos, patchSerializedItem } from './sensitivity.ts';
export type { SensitivityTarget } from './sensitivity.ts';
export { serializeLiveBattle } from './serialize.ts';
export type { StreakHistoryEntry, StreakOdds } from './streaks.ts';
export { summarizeTurn, formatRead } from './summary.ts';
export { resolveTeraPreference, teraKey } from './tera.ts';
export type { TeraPreference } from './tera.ts';
export { AUTO_MCTS_FAINTED_FRACTION } from './types.ts';
export type {
  TeraAllowance, EvalSettings, EvalPreferences, KoOddsInfo, CellBlendClass, CellBlend, KoOddsMismatch,
  RankedChoice, EvalResult, EntryUnanswered, DecidedSweep, NearDecidedSweep, UnansweredProfile, EvalMatrix,
  ForcedWin, ForcedWinCaveat, ForcedWinOpen, ForcedWinInput, ForcedWinOutcome, ForcedWinProof,
  ReadRecommendation, SearchProgress, EvalChoiceOption, EvalChoicesInfo, EvalCellJob, EvalCellValue,
  EvalSubSearchJob, MctsTreeStats, EvalWorkerRequest, EvalWorkerResponse,
} from './types.ts';
export { winProbability, winPercent, winPctText, winDeltaText } from './winprob.ts';
