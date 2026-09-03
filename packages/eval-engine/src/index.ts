/**
 * Public surface of @fulllifegames/eval-engine. Generated for the workspace split: every
 * module the app, the worker, or the sibling package reaches, with its full
 * export list. Phase 7 curates it.
 */
export {
  analyzeTurn, BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, PAYOFF_WINDOW, REGRET_THRESHOLD, TIER_THRESHOLDS,
  decidedSeenKey, unansweredSeenKey, diffChoices, findConsistentOptions, findPlayedOption, matchPlayedChoice,
  matchPlayedSide, phantomStayIn, playedSetupMove, splitCombinedLabel,
} from './analysis.ts';
export type {
  AnalyzeTurnParams, SensitivityProbe, SideAnalysis, TurnAnalysis, TurnAttribution, TurnSensitivity,
  TurnVerification, VerdictTier,
} from './analysis.ts';
export {
  describeSlotChoice, notationSlotChoice, notationSideLabel, switchChoiceKey, switchOptionKey,
  requiredChoicesForActiveSlots, conflictingSwitchTargets, branchSideChoicesReady, evalChoiceToSlotChoices,
  resolveCustomChoice,
} from './branch-choices.ts';
export type { BranchChoiceActive, BranchMoveModifier, BranchSlotChoice, ResolvedCustomChoice } from './branch-choices.ts';
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
export {
  buildChoiceLockTrails, protocolChoiceLock, corroborateChoiceItem, buildChoiceLockContext,
} from './choice-lock.ts';
export type { ProtocolLock, ChoiceLockTrails, ItemCorroboration, ChoiceLockContext } from './choice-lock.ts';
export { calcSingleDamageRange } from './damage-calc.ts';
export type { DamageResult, DamageCalcContext } from './damage-calc.ts';
export {
  deserializeBattleExact, restoreSideInvariants, serializeBattleStable, createRootPosition, positionBattle,
  legalChoices, advancePosition, advancePositionWithLog, trialAdvanceLog,
} from './forward-model.ts';
export type { ChoiceOption, SimPosition } from './forward-model.ts';
export { computeBlunders, selectKeyTurns, BLUNDER_SWING, KEY_TURN_SWING } from './graph.ts';
export {
  extractProtocolEvents, scoreAlignment, compareAlignment, isPerfectAlignment, chooseAlignedSeed,
  summarizeAlignment, ALIGNMENT_SEEDS,
} from './hax-alignment.ts';
export type {
  ProtocolEvents, AlignmentScore, SeedChoice, TurnAlignmentRecord, AlignmentSummary,
} from './hax-alignment.ts';
export { matchLeadOption, analyzeLeads, leadSpeciesOf } from './leads.ts';
export type { LeadSideAnalysis, LeadAnalysis, LeadEvalData } from './leads.ts';
export { topVisitedIndex, mergeMctsTrees, starvedSupportCells, MCTS_TREES, VERIFY_SAMPLES } from './mcts-merge.ts';
export {
  mctsSearch, mctsTreeSearch, MCTS_ITERATIONS, WIDENING_BASE, WIDENING_VISITS_PER_SLOT, wideningWindow,
} from './mcts.ts';
export type { MctsCallbacks } from './mcts.ts';
export { parseTendencies, modelOpponent, computeRead, READ_LAMBDA, READ_CONFIDENCE } from './opponent-model.ts';
export type { OpponentModel, PlayerTendencies } from './opponent-model.ts';
export { searchOrchestrated } from './orchestrator.ts';
export type { CellJob, CellValue, SubSearchJob, SearchExecutor, OrchestratorCallbacks } from './orchestrator.ts';
export { perfEnabled, perfReset, perfAdd, perfCount, perfSpan, perfSync, perfSummary, perfReport } from './perf-trace.ts';
export type { PerfSummary } from './perf-trace.ts';
export {
  parsePlayedActions, parseLeadSpecies, parsePlayedActionsDoubles, turnEvents, allTurnEvents, detectSacks,
} from './played.ts';
export type { PlayedAction, PlayedTurn, SackInfo } from './played.ts';
export {
  cellKey, reblendValue, TOP_EXPANSION, solveMatrixGame, attachLines, rankFromMatrix, selectExpansionCells,
  toResult, coreOf, GIMMICK_TOKENS, selectTieProbeCells, TIE_EPSILON, TREND_MARGIN, applyTrendExtrapolation,
  applyTrendTiebreak, TREND_LAMBDA,
} from './rank.ts';
export type { PvStep, Ranked, ValueMatrix } from './rank.ts';
export { buildGameReport, KEY_MOMENT_SWING } from './report.ts';
export type { GameReport } from './report.ts';
export {
  battleFaintedFraction, SEARCH_SEEDS, optionHints, searchOptions, createLocalExecutor, searchPosition,
  subSearchDepth1,
} from './search.ts';
export { selectProbeCombos, patchSerializedItem, CHOICE_ITEMS } from './sensitivity.ts';
export type { SensitivityTarget } from './sensitivity.ts';
export { serializeLiveBattle } from './serialize.ts';
export { detectStreakOdds } from './streaks.ts';
export type { StreakHistoryEntry, StreakOdds } from './streaks.ts';
export { summarizeTurn, formatRead } from './summary.ts';
export { parseRevealedTeraSpecies, resolveTeraPreference, teraKey } from './tera.ts';
export type { TeraPreference } from './tera.ts';
export { AUTO_MCTS_FAINTED_FRACTION } from './types.ts';
export type {
  TeraAllowance, EvalSettings, EvalPreferences, KoOddsInfo, CellBlendClass, CellBlend, KoOddsMismatch,
  RankedChoice, EvalResult, EntryUnanswered, DecidedSweep, NearDecidedSweep, UnansweredProfile, EvalMatrix,
  ReadRecommendation, SearchProgress, EvalChoiceOption, EvalChoicesInfo, EvalCellJob, EvalCellValue,
  EvalSubSearchJob, MctsTreeStats, EvalWorkerRequest, EvalWorkerResponse,
} from './types.ts';
export { winProbability, WINPROB_K, wpUnits, DISPLAY_K, winPercent, winPctText, winDeltaText } from './winprob.ts';
