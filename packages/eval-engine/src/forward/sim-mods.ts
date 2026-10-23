import { Dex } from '@pkmn/sim';
import { isChampionsFormat } from '@fulllifegames/replay-core';

/**
 * Round 67 (T145): Pokémon Champions battles run on the Champions mod of
 * @pkmn/mods (the server's data/mods/champions). Its statModify reads Stat
 * Points from the sets' `evs` (a stat is base + SP + 20, HP base + SP + 75
 * at level 50), and its scripts, conditions, items and moves carry the
 * Champions mechanics (no Terastallization, the PP pool, paralysis 1 in 8,
 * sleep and freeze turns). The simulator builds every battle from its format
 * id on the base Dex (BattleStream's start, State.deserializeBattle), so the
 * mod's formats are registered there as well; their `mod` routes each battle
 * to the Champions dex. The mod bundles a private copy of the simulator's
 * data (about 10 MB), so it loads on demand, for a Champions format only.
 */

type ChampionsMod = typeof import('@pkmn/mods/champions');
type ModData = NonNullable<Parameters<typeof Dex.mod>[1]>;

/**
 * Whether a simulator or replay format id names a Pokémon Champions format. Round 75 (T160): replay-core's isChampionsFormat is
 * the one rule (a spec compares this name with it over every format of both Dexes); it memoizes, because deserialization asks per fork.
 */
export const isChampionsSimFormat = isChampionsFormat;

let registered = false;
let loading: Promise<void> | null = null;

/**
 * Registers the Champions mod with the simulator: its dex (`Dex.mod`) and its
 * formats on the base Dex. Once per process: a second format registration
 * throws ("duplicate ID").
 */
export function registerChampionsMod(mod: ChampionsMod): void {
  if (registered) return;
  Dex.mod('champions', mod as unknown as ModData);
  Dex.formats.extend(mod.Formats);
  registered = true;
}

/**
 * Loads the simulator mod a format needs before its first battle is built or
 * revived in this realm (a worker, the main thread, a Node process); a no-op
 * for every other format. A failed load is retried on the next call.
 */
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

/**
 * loadSimMods for a serialized position, in a realm that only revives
 * positions (an evaluation worker, the branch view's adopt, the move picker).
 */
export function loadSimModsFor(serialized: string): Promise<void> {
  return registered ? Promise.resolve() : loadSimMods(FORMAT_ID.exec(serialized)?.[1] ?? '');
}

/** Whether a battle of this format can be built in this realm now. */
export const simModsReady = (format: string): boolean => registered || !isChampionsSimFormat(format);

/**
 * Fails loudly where a Champions battle would otherwise come up on the base
 * mod's rules (a rule-less gen 9 battle with Stat Points read as EVs).
 */
export function assertSimMods(format: string): void {
  if (!simModsReady(format)) {
    throw new Error(`${format} needs the Champions mod: await loadSimMods(format) before the battle is built or revived`);
  }
}
