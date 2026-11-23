import { isChampionsFormat, registerChampionsDex, type RulesModData } from '@fulllifegames/replay-core';

// Pokémon Champions battles run on the Champions mod of @pkmn/mods. Its statModify reads Stat Points from the sets' `evs` (a stat
// is base + SP + 20, HP base + SP + 75 at level 50). The simulator builds every battle from its format id on the base Dex
// (BattleStream's start, State.deserializeBattle), so the mod's formats are registered there as well; their `mod` routes each battle
// to the Champions dex. The mod loads on demand, for a Champions format only. It plays Regulation M-C and lists only its formats; a
// replay of an earlier regulation branches on the mod's OU or Doubles Custom Game (getBranchSimulatorFormat in replay-core).

type ChampionsMod = typeof import('@pkmn/mods/champions');

/**
 * Whether a simulator or replay format id names a Pokémon Champions format: replay-core's isChampionsFormat, the one rule
 * (it memoizes, because deserialization asks per fork).
 */
export const isChampionsSimFormat = isChampionsFormat;

let registered = false;
let loading: Promise<void> | null = null;

/**
 * Registers the Champions mod with the simulator: its dex (`Dex.mod`) and its formats on the base Dex. Once per process: a second
 * format registration throws ("duplicate ID").
 */
export function registerChampionsMod(mod: ChampionsMod): void {
  if (registered) return;
  registerChampionsDex(mod as unknown as RulesModData, mod.Formats);
  registered = true;
}

/** Loads the simulator mod a format needs before its first battle is built or revived in this realm; a no-op for other formats, a failed load is retried. */
export function loadSimMods(format: string): Promise<void> {
  if (registered || !isChampionsSimFormat(format)) return Promise.resolve();
  loading ??= import('@pkmn/mods/champions').then(registerChampionsMod, (error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The format a serialized position names (State.serializeBattle writes it as `formatid`). */
const FORMAT_ID = /"formatid":"([^"]*)"/;

/** loadSimMods for a serialized position, for a realm that only revives positions (an evaluation worker, the branch view's adopt, the move picker). */
export function loadSimModsFor(serialized: string): Promise<void> {
  return registered ? Promise.resolve() : loadSimMods(FORMAT_ID.exec(serialized)?.[1] ?? '');
}

/** Whether a battle of this format can be built in this realm now. */
export const simModsReady = (format: string): boolean => registered || !isChampionsSimFormat(format);

/** Fails loudly where a Champions battle would otherwise come up on the base mod's rules (Stat Points read as EVs). */
export function assertSimMods(format: string): void {
  if (!simModsReady(format)) {
    throw new Error(`${format} needs the Champions mod: await loadSimMods(format) before the battle is built or revived`);
  }
}
