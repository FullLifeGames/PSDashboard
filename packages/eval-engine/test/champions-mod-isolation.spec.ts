import { describe, expect, test } from 'vitest';
import { Battle, type PokemonSet } from '@pkmn/sim';
import { deserializeBattleExact, serializeBattleStable } from '../src/forward/serialize';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 67 (T145), in a module graph of its own (vitest isolates files): before the Champions mod is loaded, a
 * Champions position must fail loudly instead of reviving as a rule-less gen 9 battle with Stat Points read as EVs;
 * registering the mod must leave every other format's battle as it was (the bank without Champions games stays
 * byte-identical).
 */
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: 'Leftovers', ability: '', moves, nature: 'Jolly', gender: '', level: 100,
  evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function playGen9Ou(): string {
  const team = [set('Garchomp', ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Thunder Wave']), set('Great Tusk', ['Headlong Rush', 'Close Combat', 'Rapid Spin', 'Bulk Up'])];
  const battle = new Battle({ formatid: 'gen9ou' as never, seed: '1,2,3,4', p1: { name: 'A', team }, p2: { name: 'B', team } });
  for (let turn = 0; turn < 6 && !battle.ended; turn++) battle.makeChoices('default', 'default');
  return serializeBattleStable(battle);
}

describe('the Champions mod is loaded before a Champions battle (T145)', () => {
  test('a Champions position without the mod fails loudly', () => {
    expect(() => deserializeBattleExact(JSON.stringify({ formatid: 'gen9championsou' }))).toThrow(/needs the Champions mod/);
    expect(() => deserializeBattleExact(JSON.stringify({ formatid: 'gen9championsdoublescustomgame' }))).toThrow(/needs the Champions mod/);
  });

  test('registering the Champions mod leaves a gen9ou battle as it was', async () => {
    const before = playGen9Ou();
    await loadSimMods('gen9championsou');
    expect(playGen9Ou()).toBe(before);
  });
});
