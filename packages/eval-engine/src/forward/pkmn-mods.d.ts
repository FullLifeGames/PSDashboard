/**
 * Round 67 (T145): @pkmn/mods 0.10.11 exports `./champions` without a
 * `types` condition, so TypeScript cannot reach build/champions/index.d.ts
 * through the package's exports (TS7016). These are the package's own
 * declarations (build/champions/*.d.ts); the formats are typed as the list
 * the simulator's `Dex.formats.extend` takes.
 */
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
