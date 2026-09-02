/**
 * Public surface of @fulllifegames/eval-engine. Generated for the workspace split: every
 * module the app, the worker, or the sibling package reaches, with its full
 * export list. Phase 7 curates it.
 */
export {
  analyzeTurn, BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, PAYOFF_WINDOW, REGRET_THRESHOLD, TIER_THRESHOLDS,
  decidedSeenKey, unansweredSeenKey, diffChoices, findConsistentOptions, findPlayedOption, matchPlayedChoice,
  matchPlayedSide, phantomStayIn, playedSetupMove, splitCombinedLabel,
} from './analysis';
export type {
  AnalyzeTurnParams, SensitivityProbe, SideAnalysis, TurnAnalysis, TurnAttribution, TurnSensitivity,
  TurnVerification, VerdictTier,
} from './analysis';
export {
  describeSlotChoice, notationSlotChoice, notationSideLabel, switchChoiceKey, switchOptionKey,
  requiredChoicesForActiveSlots, conflictingSwitchTargets, branchSideChoicesReady, evalChoiceToSlotChoices,
  resolveCustomChoice,
} from './branch-choices';
export type { BranchChoiceActive, BranchMoveModifier, BranchSlotChoice, ResolvedCustomChoice } from './branch-choices';
export {
  applyTargetCorrections, reconstructionReached, validateBranchRuntime, correctActivesFromProtocol,
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
  annotateNicknames, executeBranchChoices, resolveSideChoices, reconstructBranchRuntime,
} from './branch-engine';
export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
  ResolvedSideCommand, ReconstructParams,
} from './branch-engine';
export {
  buildChoiceLockTrails, protocolChoiceLock, corroborateChoiceItem, buildChoiceLockContext,
} from './choice-lock';
export type { ProtocolLock, ChoiceLockTrails, ItemCorroboration, ChoiceLockContext } from './choice-lock';
export { calcSingleDamageRange } from './damage-calc';
export type { DamageResult, DamageCalcContext } from './damage-calc';
export {
  deserializeBattleExact, restoreSideInvariants, serializeBattleStable, createRootPosition, positionBattle,
  legalChoices, advancePosition, advancePositionWithLog, trialAdvanceLog,
} from './forward-model';
export type { ChoiceOption, SimPosition } from './forward-model';
export { computeBlunders, selectKeyTurns, BLUNDER_SWING, KEY_TURN_SWING } from './graph';
export {
  extractProtocolEvents, scoreAlignment, compareAlignment, isPerfectAlignment, chooseAlignedSeed,
  summarizeAlignment, ALIGNMENT_SEEDS,
} from './hax-alignment';
export type {
  ProtocolEvents, AlignmentScore, SeedChoice, TurnAlignmentRecord, AlignmentSummary,
} from './hax-alignment';
export { matchLeadOption, analyzeLeads, leadSpeciesOf } from './leads';
export type { LeadSideAnalysis, LeadAnalysis, LeadEvalData } from './leads';
export { topVisitedIndex, mergeMctsTrees, starvedSupportCells, MCTS_TREES, VERIFY_SAMPLES } from './mcts-merge';
export {
  mctsSearch, mctsTreeSearch, MCTS_ITERATIONS, WIDENING_BASE, WIDENING_VISITS_PER_SLOT, wideningWindow,
} from './mcts';
export type { MctsCallbacks } from './mcts';
export { parseTendencies, modelOpponent, computeRead, READ_LAMBDA, READ_CONFIDENCE } from './opponent-model';
export type { OpponentModel, PlayerTendencies } from './opponent-model';
export { searchOrchestrated } from './orchestrator';
export type { CellJob, CellValue, SubSearchJob, SearchExecutor, OrchestratorCallbacks } from './orchestrator';
export { perfEnabled, perfReset, perfAdd, perfCount, perfSpan, perfSync, perfSummary, perfReport } from './perf-trace';
export type { PerfSummary } from './perf-trace';
export {
  parsePlayedActions, parseLeadSpecies, parsePlayedActionsDoubles, turnEvents, allTurnEvents, detectSacks,
} from './played';
export type { PlayedAction, PlayedTurn, SackInfo } from './played';
export {
  cellKey, reblendValue, TOP_EXPANSION, solveMatrixGame, attachLines, rankFromMatrix, selectExpansionCells,
  toResult, coreOf, GIMMICK_TOKENS, selectTieProbeCells, TIE_EPSILON, TREND_MARGIN, applyTrendExtrapolation,
  applyTrendTiebreak, TREND_LAMBDA,
} from './rank';
export type { PvStep, Ranked, ValueMatrix } from './rank';
export { buildGameReport, KEY_MOMENT_SWING } from './report';
export type { GameReport } from './report';
export {
  battleFaintedFraction, SEARCH_SEEDS, optionHints, searchOptions, createLocalExecutor, searchPosition,
  subSearchDepth1,
} from './search';
export { selectProbeCombos, patchSerializedItem, CHOICE_ITEMS } from './sensitivity';
export type { SensitivityTarget } from './sensitivity';
export { serializeLiveBattle } from './serialize';
export { detectStreakOdds } from './streaks';
export type { StreakHistoryEntry, StreakOdds } from './streaks';
export { summarizeTurn, formatRead } from './summary';
export { parseRevealedTeraSpecies, resolveTeraPreference, teraKey } from './tera';
export type { TeraPreference } from './tera';
export { AUTO_MCTS_FAINTED_FRACTION } from './types';
export type {
  TeraAllowance, EvalSettings, EvalPreferences, KoOddsInfo, CellBlendClass, CellBlend, KoOddsMismatch,
  RankedChoice, EvalResult, EntryUnanswered, DecidedSweep, NearDecidedSweep, UnansweredProfile, EvalMatrix,
  ReadRecommendation, SearchProgress, EvalChoiceOption, EvalChoicesInfo, EvalCellJob, EvalCellValue,
  EvalSubSearchJob, MctsTreeStats, EvalWorkerRequest, EvalWorkerResponse,
} from './types';
export { winProbability, WINPROB_K, wpUnits, DISPLAY_K, winPercent, winPctText, winDeltaText } from './winprob';
