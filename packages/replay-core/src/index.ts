/**
 * Public surface of @fulllifegames/replay-core. Generated for the workspace split: every
 * module the app, the worker, or the sibling package reaches, with its full
 * export list. Phase 7 curates it.
 */
export { WEATHER_BY_ID, TERRAIN_BY_ID } from './calc-field';
export { resolveHiddenPowerType, typedHiddenPowerId, withHiddenPowerType, HP_TYPES } from './hidden-power';
export { toId, sideIndex } from './ids';
export type { SideId } from './ids';
export { parseShowteamSheet, inferOpponentTeam } from './opponent-inferrer';
export { parseReplayLog, parseReplayLogWithObservations } from './protocol-parser';
export {
  splitReplayPassword, getReplayGameType, inferReplayFormatId, getReplayDisplayFormat, getReplayGeneration,
  getReplayBringCount, speciesBaseId, broughtSpeciesFor, replayBringOnly, formatEnforcesSleepClause,
  getBranchSimulatorFormat,
} from './replay-format';
export { finalPlayedTurn } from './replay-turns';
export { getSpeciesSetAssumption } from './smogon/sets-lookup';
export type {
  SetAssumption, SetSpreadAssumption, PokemonSetAssumption, SmogonSetAssumptions,
} from './smogon/sets-lookup';
export type {
  UsageProbability, UsageSpread, PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, ChaosStatsPayload,
  PkmnStatsPayload,
} from './smogon/stats-types';
export {
  sourceDetail, getSpeciesUsageStats, getSpeciesUsageSet, alternativeItems, guessedFieldFromUsage,
  fillUsageMoves,
} from './smogon/usage-lookup';
export { inferSpreads, evBudget, legalizeEvs } from './spread-inference';
export type { SpreadCandidate } from './spread-inference';
export { buildTeamsFromReplay, solveReplaySpreads, extractTeamSheets } from './team-builder';
export {
  unknownField, revealedField, guessedField, manualField, unknownEvs, guessedEvs, manualEvs, manualMove,
  applyInferredSpreads, itemSetValue, enrichPokemonInfo, enrichTeamInfo, EMPTY_EVS, INFERRED_SPREAD_DETAIL,
} from './team-info';
export { parseTeamText } from './team-parser';
export { parsePastedTeam, applyPastedTeam, countMatchingSpecies } from './team-paste';
export type { PastedSet } from './team-paste';
export { applyTeamSheetToInfo } from './team-sheets';
export type {
  ReplayData, PokemonSnapshot, SideSnapshot, FieldSnapshot, TurnSnapshot, DamageObservation,
  HiddenPowerEvidence, SpeedOrderObservation, KnowledgeSource, StatId, PokemonEvs, PokemonMoveInfo,
  PokemonFieldInfo, PokemonEvsInfo, RevealedPokemonInfo, OpponentTeamInfo,
} from './types';
