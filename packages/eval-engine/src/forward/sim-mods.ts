import { isChampionsFormat, registerChampionsDex, type RulesModData } from '@fulllifegames/replay-core';

// The Champions mod's statModify reads Stat Points from the sets' `evs` (a stat is base + SP + 20, HP base + SP + 75).
// It plays Regulation M-C and lists only its formats; a replay of an earlier regulation branches on its Custom Game.

type ChampionsMod = typeof import('@pkmn/mods/champions');

/** replay-core's isChampionsFormat, the one rule (it memoizes: deserialization asks per fork). */
export const isChampionsSimFormat = isChampionsFormat;

let registered = false;
let loading: Promise<void> | null = null;

/** Registers the Champions mod's dex and formats; once per process: a second registration throws ("duplicate ID"). */
export function registerChampionsMod(mod: ChampionsMod): void {
  if (registered) return;
  registerChampionsDex(mod as unknown as RulesModData, mod.Formats);
  registered = true;
}

/** Loads the mod a format needs before its first battle in this realm; a no-op for others, a failed load retries. */
export function loadSimMods(format: string): Promise<void> {
  if (registered || !isChampionsSimFormat(format)) return Promise.resolve();
  loading ??= import('@pkmn/mods/champions').then(registerChampionsMod, (error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

const FORMAT_ID = /"formatid":"([^"]*)"/;

export function loadSimModsFor(serialized: string): Promise<void> {
  return registered ? Promise.resolve() : loadSimMods(FORMAT_ID.exec(serialized)?.[1] ?? '');
}

export const simModsReady = (format: string): boolean => registered || !isChampionsSimFormat(format);

/** Fails loudly where a Champions battle would run on the base mod's rules (Stat Points read as EVs). */
export function assertSimMods(format: string): void {
  if (!simModsReady(format)) {
    throw new Error(`${format} needs the Champions mod: await loadSimMods(format) before the battle is built or revived`);
  }
}
