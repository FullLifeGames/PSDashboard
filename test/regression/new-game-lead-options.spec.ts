import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { loadSimMods, startGameLog } from '@fulllifegames/eval-engine';
import { gameLeadOptions } from '../../src/lib/new-game/lead-options';
import { newGameRecord, type NewGameRecord } from '../../src/lib/new-game/record';

/** Round 89 (lane H, #105), stage H3: a new game offers its record's teams to the lead picker, in a format with team preview and in one without. */

const SIX: PokemonSet[] = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'].map(species => ({
  name: species, species, item: '', ability: '', moves: ['Earthquake', 'Protect'], nature: '', gender: '',
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
}));

async function recordOf(format: string): Promise<NewGameRecord> {
  await loadSimMods(format);
  const start = await startGameLog({ format, p1Team: SIX, p2Team: SIX, playerNames: ['Alice', 'Bob'] });
  return newGameRecord({ start, formatName: format, players: ['Alice', 'Bob'] });
}

const lead = (p1: string[], p2: string[], bring = false) =>
  ({ turnNumber: 0, p1Choice: '', p2Choice: '', leadChoices: { p1, p2, ...(bring ? { bring: true } : {}) }, p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [] });

describe('the lead options of a new game', () => {
  for (const format of ['gen9ou', 'gen4ou', 'gen9doublesou']) {
    test(`${format}: all six bodies of both teams, none marked before the pick`, async () => {
      const options = gameLeadOptions(await recordOf(format));
      expect(options.p1.map(option => option.species)).toEqual(SIX.map(set => set.species));
      expect(options.p2).toHaveLength(6);
      expect([...options.p1, ...options.p2].some(option => option.wasLead || option.wasBrought)).toBe(false);
    });
  }

  test('after the pick the leads are marked, and a bring marks its whole selection as brought (doubles: two leads)', async () => {
    const record = await recordOf('gen9vgc2025regi');
    const picked = { ...record, entries: [lead(['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar'], ['Snorlax', 'Starmie', 'Garchomp', 'Gengar'], true)] };
    const options = gameLeadOptions(picked);
    expect(options.p1.filter(option => option.wasLead).map(option => option.species)).toEqual(['Garchomp', 'Gengar']);
    expect(options.p1.filter(option => option.wasBrought).map(option => option.species)).toEqual(['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar']);
    expect(options.p2.filter(option => option.wasLead).map(option => option.species)).toEqual(['Snorlax', 'Starmie']);
  });
});
