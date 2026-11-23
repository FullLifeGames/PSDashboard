/** Lazy-load boundary: the app reaches these re-exports through import(), so they stay out of the entry chunk. */
export {
  applyTargetCorrections, reconstructionReached, validateBranchRuntime, correctActivesFromProtocol,
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
  annotateNicknames, executeBranchChoices, resolveSideChoices, reconstructBranchRuntime, adoptSerializedRuntime,
  loadSimMods, loadSimModsFor, startGameLog, checkGameTeams, loggedDiceAt, loggedTurnDice, offeredDice, offeredEndDice, offeredOrderDice, secondariesIn,
} from '@fulllifegames/eval-engine';
export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
  ResolvedSideCommand, ReconstructParams, AdoptParams, BranchDiceTurn, DieOffer,
} from '@fulllifegames/eval-engine';
