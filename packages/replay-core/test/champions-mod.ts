import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';

// The resolver throws without the mod: a spec that reads a Champions game imports this file first.
if (!Dex.dexes.champions) Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
