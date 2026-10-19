/**
 * Public surface of @fulllifegames/replay-core. Curated: the names the app, the worker, the
 * sibling package, the worked example, and the root suite reach, plus every
 * type their signatures mention. Widen it by adding a line here and refreshing
 * regression/fixtures/api/replay-core.txt (UPDATE_API_SNAPSHOT=1). The
 * package's own tests import the sources directly; the root suite imports by
 * name, so it consumes this list like any other user.
 */
export { WEATHER_BY_ID, TERRAIN_BY_ID } from './calc-field.ts';
export { calcGenerationFor, calcModOf, simGenNum, CHAMPIONS_MOD } from './calc-gen.ts';
export { generationsFor } from './format-generations.ts';
export type { GenerationsScope, LegalDex } from './format-generations.ts';
export type { CalcGeneration } from './calc-gen.ts';
export { buildCalcPokemon, calcBaseStats, calcKnowsMove, calcSpecies, speciesOverrides } from './calc-build.ts';
export type { CalcPokemonOptions, SpeciesDex } from './calc-build.ts';
export {
  protectKind, choiceItems, hazardConditions, terrainConditions, umbrellaWeathers, SCREENS, isScreen, screenFlags,
} from './dex-facts/index.ts';
export type { FactsDex, ProtectKind, ScreenId } from './dex-facts/index.ts';
export { resolveHiddenPowerType, typedHiddenPowerId, withHiddenPowerType, HP_TYPES } from './hidden-power.ts';
export { toId, sideIndex } from './ids.ts';
export type { SideId } from './ids.ts';
export { inferOpponentTeam } from './opponent-inferrer.ts';
export { parseReplayLog, parseReplayLogWithObservations } from './protocol-parser.ts';
export {
  splitReplayPassword, getReplayGameType, inferReplayFormatId, getReplayDisplayFormat, getReplayGeneration,
  getReplayBringCount, speciesBaseId, broughtSpeciesFor, replayBringOnly, formatEnforcesSleepClause, replayRuleset,
  getBranchSimulatorFormat,
} from './replay-format.ts';
export type { ReplayRuleset } from './replay-format.ts';
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
export type { SpeedKnowledge, SpeedKnowledgeMap, SpreadCandidate } from './spread-inference.ts';
export type { SpreadOrigin } from './spreads/ladder.ts';
export { calcEvs, calcIvs, evBudget } from './spreads/ev-budget.ts';
export type { EvBudget } from './spreads/ev-budget.ts';
export { buildTeamsFromReplay, solveReplaySpreads, extractTeamSheets } from './team-builder.ts';
export {
  manualField, manualEvs, manualMove, applyInferredSpreads, itemSetValue, enrichTeamInfo, enrichPokemonInfo,
  unknownEvs, EMPTY_EVS, INFERRED_SPREAD_DETAIL, INFERRED_ITEM_DETAIL, RULED_OUT_ITEM_DETAIL, NO_BOOST_ITEM_DETAIL,
  ORDER_SPREAD_DETAIL, MEASURED_HP_SPREAD_DETAIL,
} from './team-info.ts';
export { enrichTeamInfos } from './team/damage-ruleouts.ts';
export type { ItemDamageJudge } from './team/damage-ruleouts.ts';
export { judgeItemsByDamage } from './team/item-damage.ts';
export { parseTeamText } from './team-parser.ts';
export { parsePastedTeam, applyPastedTeam, countMatchingSpecies } from './team-paste.ts';
export type { PastedSet } from './team-paste.ts';
export { applyTeamSheetToInfo } from './team-sheets.ts';
export type {
  ReplayData, PokemonSnapshot, SideSnapshot, FieldSnapshot, TurnSnapshot, DamageObservation,
  HiddenPowerEvidence, SpeedOrderObservation, KnowledgeSource, StatId, PokemonEvs, PokemonMoveInfo,
  PokemonFieldInfo, PokemonEvsInfo, RevealedPokemonInfo, OpponentTeamInfo, LoggedHit, HitParty,
} from './types.ts';
