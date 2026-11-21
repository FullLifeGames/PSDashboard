import { beforeAll, describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { checkGameTeams, loadSimMods, startGameLog } from '../src/index';
import { legalTeams } from './new-game-teams';

/**
 * Round 89 (lane M, NG-2): the New game dialog blocks Start for a species the format's Dex does not know, and it asks the same rule
 * that Start applies (`refuseUnknownSpecies`): `checkGameTeams` hands the refusal back per side, word for word what `startGameLog`
 * throws, and null for a side whose species the Dex knows. Singles, doubles, VGC and a Champions format.
 */

const FORMATS = ['gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9championsou', 'gen9championsvgc2026regmc'];
const UNKNOWN = 'Zzqxvwk';

beforeAll(async () => {
  await loadSimMods('gen9championsou');
}, 60_000);

describe('the refusal of an unknown species, per side', () => {
  for (const id of FORMATS) {
    test(`${id}: the check names what Start refuses, and a known side has none`, async () => {
      const base = legalTeams(id);
      if ('problems' in base) throw new Error(`${id} has no legal team`);
      const bad: PokemonSet[] = [{ ...base.p2[0], species: UNKNOWN, name: UNKNOWN }, ...base.p2.slice(1)];
      const checked = await checkGameTeams(id, { p1: base.p1, p2: bad });
      expect(checked.refused).toEqual({ p1: null, p2: `${UNKNOWN} is no Pokémon of ${Dex.formats.get(id).name}. Fix the set to start.` });
      const started = await startGameLog({ format: id, p1Team: base.p1, p2Team: bad }).then(() => 'started', (error: Error) => error.message);
      expect(started).toBe(checked.refused.p2);
      expect((await checkGameTeams(id, base)).refused).toEqual({ p1: null, p2: null });
    }, 60_000);
  }
});
