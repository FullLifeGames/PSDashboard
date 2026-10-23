import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';

/**
 * Round 75 (T160): a spec that reads a Pokémon Champions game registers the mod first, as the hosts do (eval-engine's
 * loadSimMods): the resolver throws for a Champions game without it. Importing this file registers it, once per worker.
 */
if (!Dex.dexes.champions) Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
