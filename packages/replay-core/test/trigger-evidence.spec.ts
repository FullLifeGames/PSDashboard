import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * A guessed item whose trigger the protocol shows without the item's line is
 * ruled out (round 67, T130, decision 18). The round-64 census counted the
 * guesses the simulator consumed where the game showed nothing: Air Balloon,
 * Booster Energy and Eject Pack made 554 of the 562 singles rows. Every log
 * here comes from @pkmn/sim: each case first checks what a holder shows, then
 * what the inference reads for the side p2 from a log without the item.
 */

function set(species: string, item: string, ability: string, moves: string[], level = 100): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Hardy', level, gender: '',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

function play(p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], options: { doubles?: boolean; gen?: number; format?: string } = {}): string {
  const { doubles = false, gen = 9, format = 'ou' } = options;
  const battle = new Battle({
    formatid: toID(doubles ? `gen${gen}doubles${format}` : `gen${gen}${format}`), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  // An empty choice skips the side: a mid-turn switch request asks only one player.
  for (const [p1Choice, p2Choice] of turns) {
    if (p1Choice) battle.choose('p1', p1Choice);
    if (p2Choice) battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const ruledOut = (log: string, species: string) =>
  inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species)?.ruledOut?.items ?? [];
const wall = () => set('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss']);

describe('Air Balloon announces itself on entry (T130)', () => {
  const lead = (item: string) => set('Heatran', item, 'Flash Fire', ['Magma Storm', 'Protect']);
  const turn: [string, string] = ['move softboiled', 'move protect'];

  test('singles: an entry without the announcement rules Air Balloon out', () => {
    expect(play([wall()], [lead('Air Balloon'), wall()], [turn])).toMatch(/\|-item\|p2a: Heatran\|Air Balloon/);
    const log = play([wall()], [lead('Leftovers'), wall()], [turn]);
    expect(ruledOut(log, 'Heatran')).toContain('airballoon');
  });

  test('doubles: both leads without the announcement have no Air Balloon', () => {
    const p1 = [wall(), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])];
    const p2 = (item: string) => [lead(item), set('Excadrill', item, 'Mold Breaker', ['Protect', 'Iron Head']), wall()];
    const turns: [string, string][] = [['move softboiled, move softboiled', 'move protect, move protect']];
    expect(play(p1, p2('Air Balloon'), turns, { doubles: true })).toMatch(/\|-item\|p2b: Excadrill\|Air Balloon/);
    const log = play(p1, p2('Leftovers'), turns, { doubles: true });
    expect(ruledOut(log, 'Heatran')).toContain('airballoon');
    expect(ruledOut(log, 'Excadrill')).toContain('airballoon');
  });

  test('gen 5: the same holds where Air Balloon first exists', () => {
    expect(play([wall()], [lead('Air Balloon'), wall()], [turn], { gen: 5 })).toMatch(/\|-item\|p2a: Heatran\|Air Balloon/);
    expect(ruledOut(play([wall()], [lead('Leftovers'), wall()], [turn], { gen: 5 }), 'Heatran')).toContain('airballoon');
  });

  test('a mid-battle switch-in without the announcement rules Air Balloon out (2658669868 t24 shape)', () => {
    const gholdengo = (item: string) => set('Gholdengo', item, 'Good as Gold', ['Make It Rain', 'Recover']);
    const turns: [string, string][] = [['move softboiled', 'move protect'], ['move softboiled', 'switch 2']];
    expect(play([wall()], [lead('Leftovers'), gholdengo('Air Balloon')], turns)).toMatch(/\|-item\|p2a: Gholdengo\|Air Balloon/);
    expect(ruledOut(play([wall()], [lead('Leftovers'), gholdengo('Leftovers')], turns), 'Gholdengo')).toContain('airballoon');
  });

  test('under Gravity the holder shows nothing: nothing is ruled out', () => {
    const gravity = set('Bronzong', 'Leftovers', 'Levitate', ['Gravity', 'Protect']);
    const turns: [string, string][] = [['move gravity', 'move protect'], ['move protect', 'switch 2']];
    const entrant = (item: string) => set('Rotom-Wash', item, 'Levitate', ['Hydro Pump', 'Protect']);
    expect(play([gravity], [lead('Leftovers'), entrant('Air Balloon')], turns)).not.toMatch(/\|-item\|p2a: Rotom\|Air Balloon/);
    expect(ruledOut(play([gravity], [lead('Leftovers'), entrant('Leftovers')], turns), 'Rotom-Wash')).not.toContain('airballoon');
  });

  test('a species that may have Klutz is not judged', () => {
    const lopunny = set('Lopunny', 'Leftovers', 'Limber', ['Fake Out', 'Protect']);
    expect(ruledOut(play([wall()], [lopunny, wall()], [['move softboiled', 'move protect']]), 'Lopunny')).not.toContain('airballoon');
  });

  test('a team that may hold an Illusion user is not judged', () => {
    const zoroark = set('Zoroark-Hisui', 'Leftovers', 'Illusion', ['Bitter Malice']);
    const log = play([wall()], [lead('Leftovers'), zoroark], [turn]);
    expect(ruledOut(log, 'Heatran')).not.toContain('airballoon');
  });
});

describe('Booster Energy is spent on entry outside its weather or terrain (T130)', () => {
  const tusk = (item: string) => set('Great Tusk', item, 'Protosynthesis', ['Headlong Rush', 'Protect']);
  const hands = (item: string) => set('Iron Hands', item, 'Quark Drive', ['Drain Punch', 'Protect']);

  test('singles: a Protosynthesis entry outside sun without the line rules Booster Energy out', () => {
    const turn: [string, string] = ['move softboiled', 'move protect'];
    expect(play([wall()], [tusk('Booster Energy'), wall()], [turn])).toMatch(/\|-enditem\|p2a: Great Tusk\|Booster Energy/);
    expect(ruledOut(play([wall()], [tusk('Leftovers'), wall()], [turn]), 'Great Tusk')).toContain('boosterenergy');
  });

  test('doubles: a Quark Drive entry outside Electric Terrain without the line rules Booster Energy out', () => {
    const p1 = [wall(), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])];
    const turns: [string, string][] = [['move softboiled, move softboiled', 'move protect, move protect']];
    const p2 = (item: string) => [hands(item), tusk('Leftovers'), wall()];
    expect(play(p1, p2('Booster Energy'), turns, { doubles: true })).toMatch(/\|-enditem\|p2a: Iron Hands\|Booster Energy/);
    expect(ruledOut(play(p1, p2('Leftovers'), turns, { doubles: true }), 'Iron Hands')).toContain('boosterenergy');
  });

  test('in sun the holder keeps the item: nothing is ruled out', () => {
    const sun = set('Torkoal', 'Heat Rock', 'Drought', ['Protect', 'Lava Plume']);
    const turns: [string, string][] = [['move protect', 'move protect'], ['move protect', 'switch 2']];
    expect(play([sun], [wall(), tusk('Booster Energy')], turns)).not.toMatch(/\|-enditem\|p2a: Great Tusk\|Booster Energy/);
    expect(ruledOut(play([sun], [wall(), tusk('Leftovers')], turns), 'Great Tusk')).not.toContain('boosterenergy');
  });
});

describe('Eject Pack switches its holder out after a stat drop (T130)', () => {
  const intimidate = () => set('Incineroar', 'Leftovers', 'Intimidate', ['Fake Out', 'Parting Shot', 'Protect']);
  const target = (item: string) => set('Garchomp', item, 'Rough Skin', ['Protect', 'Close Combat']);

  test('singles: a drop from Intimidate without the eject rules Eject Pack out', () => {
    const turn: [string, string] = ['move protect', 'move protect'];
    expect(play([intimidate()], [target('Eject Pack'), wall()], [turn])).toMatch(/\|-enditem\|p2a: Garchomp\|Eject Pack/);
    expect(ruledOut(play([intimidate()], [target('Leftovers'), wall()], [turn]), 'Garchomp')).toContain('ejectpack');
  });

  test('singles: a self-inflicted drop without the eject rules Eject Pack out', () => {
    const p1 = [set('Corviknight', 'Leftovers', 'Pressure', ['Roost'])];
    const turn: [string, string] = ['move roost', 'move closecombat'];
    expect(play(p1, [target('Eject Pack'), wall()], [turn])).toMatch(/\|-enditem\|p2a: Garchomp\|Eject Pack/);
    expect(ruledOut(play(p1, [target('Leftovers'), wall()], [turn]), 'Garchomp')).toContain('ejectpack');
  });

  test('doubles: Intimidate on both leads without an eject rules Eject Pack out for both', () => {
    const p1 = [intimidate(), wall()];
    const p2 = (item: string) => [target(item), set('Dragonite', item, 'Multiscale', ['Protect', 'Extreme Speed']), wall()];
    const turns: [string, string][] = [['move protect, move softboiled', 'move protect, move protect']];
    expect(play(p1, p2('Eject Pack'), turns, { doubles: true })).toMatch(/\|-enditem\|p2a: Garchomp\|Eject Pack/);
    const log = play(p1, p2('Leftovers'), turns, { doubles: true });
    expect(ruledOut(log, 'Garchomp')).toContain('ejectpack');
    expect(ruledOut(log, 'Dragonite')).toContain('ejectpack');
  });

  test('the last Pokémon cannot switch: nothing is ruled out', () => {
    const turn: [string, string] = ['move protect', 'move protect'];
    expect(play([intimidate()], [target('Eject Pack')], [turn])).not.toMatch(/Eject Pack/);
    expect(ruledOut(play([intimidate()], [target('Leftovers')], [turn]), 'Garchomp')).not.toContain('ejectpack');
  });

  test('a drop from Parting Shot never ejects: nothing is ruled out', () => {
    const p1 = [set('Incineroar', 'Leftovers', 'Blaze', ['Parting Shot']), wall()];
    // Garchomp moves first, Parting Shot drops it, p1 brings Blissey in, and a second turn closes the window.
    const turns: [string, string][] = [['move partingshot', 'move earthquake'], ['switch 2', ''], ['move softboiled', 'move earthquake']];
    const holder = (item: string) => set('Garchomp', item, 'Rough Skin', ['Protect', 'Earthquake']);
    const withPack = play(p1, [holder('Eject Pack'), wall()], turns);
    expect(withPack).toMatch(/\|-unboost\|p2a: Garchomp\|atk\|1/);
    expect(withPack).toMatch(/\|upkeep[\s\S]*\|move\|[\s\S]*\|upkeep/);
    expect(withPack).not.toMatch(/\|-enditem\|p2a: Garchomp\|Eject Pack/);
    expect(ruledOut(play(p1, [holder('Leftovers'), wall()], turns), 'Garchomp')).not.toContain('ejectpack');
  });
});
