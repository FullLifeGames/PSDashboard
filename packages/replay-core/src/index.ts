/**
 * Public surface of @fulllifegames/replay-core. Generated for the workspace split: every
 * module the app, the worker, or the sibling package reaches, with its full
 * export list. Phase 7 curates it.
 */
export { WEATHER_BY_ID, TERRAIN_BY_ID } from './calc-field.ts';
export { resolveHiddenPowerType, typedHiddenPowerId, withHiddenPowerType, HP_TYPES } from './hidden-power.ts';
export { toId, sideIndex } from './ids.ts';
export type { SideId } from './ids.ts';
export { parseShowteamSheet, inferOpponentTeam } from './opponent-inferrer.ts';
export { parseReplayLog, parseReplayLogWithObservations } from './protocol-parser.ts';
export {
  splitReplayPassword, getReplayGameType, inferReplayFormatId, getReplayDisplayFormat, getReplayGeneration,
  getReplayBringCount, speciesBaseId, broughtSpeciesFor, replayBringOnly, formatEnforcesSleepClause,
  getBranchSimulatorFormat,
} from './replay-format.ts';
export { finalPlayedTurn } from './replay-turns.ts';
export { getSpeciesSetAssumption } from './smogon/sets-lookup.ts';
export type {
  SetAssumption, SetSpreadAssumption, PokemonSetAssumption, SmogonSetAssumptions,
} from './smogon/sets-lookup.ts';
export type {
  UsageProbability, UsageSpread, PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, ChaosStatsPayload,
  PkmnStatsPayload,
} from './smogon/stats-types.ts';
export {
  sourceDetail, getSpeciesUsageStats, getSpeciesUsageSet, alternativeItems, guessedFieldFromUsage,
  fillUsageMoves,
} from './smogon/usage-lookup.ts';
export { inferSpreads, evBudget, legalizeEvs } from './spread-inference.ts';
export type { SpreadCandidate } from './spread-inference.ts';
export { buildTeamsFromReplay, solveReplaySpreads, extractTeamSheets } from './team-builder.ts';
export {
  unknownField, revealedField, guessedField, manualField, unknownEvs, guessedEvs, manualEvs, manualMove,
  applyInferredSpreads, itemSetValue, enrichPokemonInfo, enrichTeamInfo, EMPTY_EVS, INFERRED_SPREAD_DETAIL,
} from './team-info.ts';
export { parseTeamText } from './team-parser.ts';
export { parsePastedTeam, applyPastedTeam, countMatchingSpecies } from './team-paste.ts';
export type { PastedSet } from './team-paste.ts';
export { applyTeamSheetToInfo } from './team-sheets.ts';
export type {
  ReplayData, PokemonSnapshot, SideSnapshot, FieldSnapshot, TurnSnapshot, DamageObservation,
  HiddenPowerEvidence, SpeedOrderObservation, KnowledgeSource, StatId, PokemonEvs, PokemonMoveInfo,
  PokemonFieldInfo, PokemonEvsInfo, RevealedPokemonInfo, OpponentTeamInfo,
} from './types.ts';
