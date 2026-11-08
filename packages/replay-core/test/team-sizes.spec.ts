import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex, simFormats } from '../src/rules-dex';
import { teamSizes } from '../src/replay-format';

/**
 * Round 88 (F, #101): `|teamsize|` is a side's real body count. The simulator prints it at the start action for every side, after
 * the preview if there is one (battle.js: `this.add('teamsize', side.id, side.pokemon.length)`): the brought count with a preview
 * (VGC 4), the whole team without. One reader turns the line into numbers, and the stand-in step, the near sentence's phase and the
 * inference's bench test all read it there. The sweep plays every format of the Dex and the Champions mod that has a fixed team.
 */
registerChampionsDex(championsMod as unknown as Parameters<typeof registerChampionsDex>[0], championsMod.Formats as unknown as Parameters<typeof registerChampionsDex>[1]);

/** Six distinct bodies of the format's generation: the sample team of a sweep row. */
function sampleTeam(formatId: string): PokemonSet[] {
  const dex = Dex.forFormat(simFormats().get(formatId));
  const species = dex.species.all().filter(entry => entry.exists && !entry.isNonstandard && !entry.forme && entry.gen <= dex.gen && entry.num > 0);
  const base = new Set<string>();
  const team: PokemonSet[] = [];
  for (const entry of species) {
    if (base.has(entry.baseSpecies)) continue;
    base.add(entry.baseSpecies);
    team.push({
      name: entry.name, species: entry.name, item: '', ability: dex.gen >= 3 ? entry.abilities[0] : '', moves: ['tackle'], nature: '', gender: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
    } as PokemonSet);
    if (team.length === 6) break;
  }
  return team;
}

describe('teamSizes reads the |teamsize| lines', () => {
  test('the last line of a side wins, a side without a line is null, CRLF and arrays read alike', () => {
    const log = ['|player|p1|A|', '|teamsize|p1|6', '|teamsize|p2|4', '|start', '|turn|1'].join('\n');
    expect(teamSizes(log)).toEqual({ p1: 6, p2: 4 });
    expect(teamSizes(log.replaceAll('\n', '\r\n'))).toEqual({ p1: 6, p2: 4 });
    expect(teamSizes(log.split('\n'))).toEqual({ p1: 6, p2: 4 });
    expect(teamSizes('|teamsize|p1|6\n|teamsize|p1|3')).toEqual({ p1: 3, p2: null });
    expect(teamSizes('|turn|1')).toEqual({ p1: null, p2: null });
  });
});

describe('S1: the simulator prints the side\'s body count as |teamsize| in every format with a fixed team', () => {
  const formats = simFormats().all().filter(format => !format.team && format.effectType === 'Format' && !/random|hackmonscup|freeforall/.test(format.id));

  test('the sample covers singles, doubles and Champions formats', () => {
    expect(formats.length).toBeGreaterThan(150);
    expect(formats.some(format => /championsvgc/.test(format.id))).toBe(true);
    expect(formats.some(format => format.gameType === 'doubles')).toBe(true);
  });

  test('teamSizes of the simulator\'s own log equals each side\'s body count after the preview', () => {
    const wrong: string[] = [];
    let played = 0;
    const counts = new Map<number, number>();
    let previewless = 0;
    for (const format of formats) {
      const team = sampleTeam(format.id);
      if (team.length < 6) continue;
      try {
        const battle = new Battle({ formatid: format.id as never, seed: [1, 2, 3, 4], p1: { name: 'a', team: team as never }, p2: { name: 'b', team: team as never } });
        if (battle.requestState === 'teampreview') battle.makeChoices('default', 'default');
        const sizes = teamSizes(battle.log);
        const real = { p1: battle.sides[0].pokemon.length, p2: battle.sides[1].pokemon.length };
        played++;
        if (!simFormats().getRuleTable(format).has('teampreview')) previewless++;
        counts.set(real.p1, (counts.get(real.p1) ?? 0) + 1);
        if (sizes.p1 !== real.p1 || sizes.p2 !== real.p2) wrong.push(`${format.id}: log ${sizes.p1}/${sizes.p2}, sides ${real.p1}/${real.p2}`);
      } catch (error) {
        wrong.push(`${format.id} threw ${String(error).slice(0, 80)}`);
        
      }
    }
    expect(played).toBeGreaterThan(150);
    expect(counts.get(4) ?? 0).toBeGreaterThan(5);
    expect(counts.get(6) ?? 0).toBeGreaterThan(100);
    expect(previewless).toBeGreaterThan(30);
    expect(wrong).toEqual([]);
  });
});
