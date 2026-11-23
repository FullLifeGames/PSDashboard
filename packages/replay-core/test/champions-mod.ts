import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';

// A spec that reads a Pokémon Champions game registers the mod first, as the hosts do: the resolver throws without it. Importing this file registers it once per worker.
if (!Dex.dexes.champions) Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
