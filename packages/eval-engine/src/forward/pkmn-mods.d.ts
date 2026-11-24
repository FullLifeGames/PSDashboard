// @pkmn/mods exports `./champions` without a `types` condition (TS7016): these are the package's own declarations
// (build/champions/*.d.ts).
declare module '@pkmn/mods/champions' {
  import type {
    Dex, ModdedAbilityDataTable, ModdedBattleScriptsData, ModdedConditionDataTable, ModdedFormatDataTable,
    ModdedItemDataTable, ModdedLearnsetDataTable, ModdedMoveDataTable, ModdedSpeciesFormatsDataTable,
  } from '@pkmn/sim';

  export const Abilities: ModdedAbilityDataTable;
  export const Conditions: ModdedConditionDataTable;
  export const Formats: Parameters<typeof Dex.formats.extend>[0];
  export const FormatsData: ModdedSpeciesFormatsDataTable;
  export const Items: ModdedItemDataTable;
  export const Learnsets: ModdedLearnsetDataTable;
  export const Moves: ModdedMoveDataTable;
  export const Rulesets: ModdedFormatDataTable;
  export const Scripts: ModdedBattleScriptsData;
}
