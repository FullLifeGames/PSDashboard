/**
 * Public surface of @fulllifegames/replay-core. Curated: the names the app, the worker, the
 * sibling package, and the worked example reach, plus every type their
 * signatures mention. Widen it by adding a line here and refreshing
 * regression/fixtures/api/replay-core.txt (UPDATE_API_SNAPSHOT=1); the
 * suites import package sources directly and never depend on this list.
 */
export { WEATHER_BY_ID, TERRAIN_BY_ID } from './calc-field.ts';
export { resolveHiddenPowerType, typedHiddenPowerId, withHiddenPowerType, HP_TYPES } from './hidden-power.ts';
export { toId, sideIndex } from './ids.ts';
export type { SideId } from './ids.ts';
export { inferOpponentTeam } from './opponent-inferrer.ts';
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
export type { SpreadCandidate } from './spread-inference.ts';
export { buildTeamsFromReplay, solveReplaySpreads, extractTeamSheets } from './team-builder.ts';
export {
  manualField, manualEvs, manualMove, applyInferredSpreads, itemSetValue, enrichTeamInfo, EMPTY_EVS,
  INFERRED_SPREAD_DETAIL,
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
