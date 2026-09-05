/**
 * Lazy-load boundary: the app reaches this module through import() so it
 * stays out of the entry chunk. Re-exports only; the package barrel is the API.
 */
export {
  applyTargetCorrections, reconstructionReached, validateBranchRuntime, correctActivesFromProtocol,
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
  annotateNicknames, executeBranchChoices, resolveSideChoices, reconstructBranchRuntime, adoptSerializedRuntime,
} from '@fulllifegames/eval-engine';
export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
  ResolvedSideCommand, ReconstructParams, AdoptParams,
} from '@fulllifegames/eval-engine';
