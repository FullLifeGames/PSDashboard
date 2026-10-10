import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * T108 step 2 (round 67, spec decision 19): the inference takes from its own
 * @pkmn/client walk the facts its handlers missed, class by class as the
 * census of client against inference found them (544 deviations in 133
 * bank and feedback games): an ability the line names as its effect
 * (`|-activate|p2a: X|ability: Quark Drive`, a Queenly Majesty block), an item
 * a line names from the holder's own side (`[from] item: Toxic Orb` on a
 * status line, Poltergeist), and the client's rule for a move that is no
 * choice of the user's own (a Magic Bounce reflection, a move while
 * transformed, Struggle). Every log comes from @pkmn/sim; each case checks
 * the simulator's line first, then what the inference reads for p2.
 */

function set(species: string, item: string, ability: string, moves: string[], level = 100): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Hardy', level, gender: '',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

function play(p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false): string {
  const battle = new Battle({
    formatid: toID(doubles ? 'gen9doublesou' : 'gen9ou'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  for (const [p1Choice, p2Choice] of turns) {
    if (p1Choice) battle.choose('p1', p1Choice);
    if (p2Choice) battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const mon = (log: string, species: string) => inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === species);
const moves = (log: string, species: string) => mon(log, species)?.moves.map(move => move.name) ?? [];
const wall = () => set('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled', 'Protect']);
const partner = () => set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled', 'Protect']);

describe('an ability the line names as its effect comes from the client (T108 step 2)', () => {
  const hands = () => set('Iron Hands', 'Booster Energy', 'Quark Drive', ['Drain Punch', 'Protect']);
  const glimmora = () => set('Glimmora', 'Focus Sash', 'Toxic Debris', ['Protect', 'Mortal Spin']);

  test('singles: Quark Drive activates from Booster Energy, Toxic Debris from a physical hit', () => {
    const quark = play([wall()], [hands(), wall()], [['move softboiled', 'move protect']]);
    expect(quark).toMatch(/\|-activate\|p2a: Iron Hands\|ability: Quark Drive\|\[fromitem\]/);
    expect(mon(quark, 'Iron Hands')?.ability).toEqual({ value: 'Quark Drive', source: 'revealed' });
    const tusk = set('Great Tusk', 'Leftovers', 'Protosynthesis', ['Headlong Rush', 'Rapid Spin']);
    const debris = play([tusk], [glimmora(), wall()], [['move rapidspin', 'move mortalspin']]);
    expect(debris).toMatch(/\|-activate\|p2a: Glimmora\|ability: Toxic Debris/);
    expect(mon(debris, 'Glimmora')?.ability).toEqual({ value: 'Toxic Debris', source: 'revealed' });
  });

  test('doubles: Quark Drive and a Queenly Majesty block name their holders', () => {
    const quark = play([wall(), partner()], [partner(), hands(), wall()], [['move softboiled, move softboiled', 'move protect, move protect']], true);
    expect(quark).toMatch(/\|-activate\|p2b: Iron Hands\|ability: Quark Drive\|\[fromitem\]/);
    expect(mon(quark, 'Iron Hands')?.ability).toEqual({ value: 'Quark Drive', source: 'revealed' });
    const fakeOut = set('Incineroar', 'Sitrus Berry', 'Blaze', ['Fake Out', 'Protect']);
    const tsareena = set('Tsareena', 'Wide Lens', 'Queenly Majesty', ['Protect', 'Trop Kick']);
    const majesty = play([fakeOut, partner()], [tsareena, partner(), wall()], [['move fakeout 2, move protect', 'move protect, move protect']], true);
    expect(majesty).toMatch(/\|cant\|p2a: Tsareena\|ability: Queenly Majesty\|Fake Out/);
    expect(mon(majesty, 'Tsareena')?.ability).toEqual({ value: 'Queenly Majesty', source: 'revealed' });
  });

  test('singles: a Queenly Majesty block names its holder', () => {
    const fakeOut = set('Incineroar', 'Sitrus Berry', 'Blaze', ['Fake Out', 'Protect']);
    const tsareena = set('Tsareena', 'Wide Lens', 'Queenly Majesty', ['Protect', 'Trop Kick']);
    const log = play([fakeOut], [tsareena, wall()], [['move fakeout', 'move tropkick']]);
    expect(log).toMatch(/\|cant\|p2a: Tsareena\|ability: Queenly Majesty\|Fake Out/);
    expect(mon(log, 'Tsareena')?.ability).toEqual({ value: 'Queenly Majesty', source: 'revealed' });
  });

  test('an ability the species cannot hold stays out: Ogerpon-Wellspring\'s Tera shows Embody Aspect', () => {
    const ogerpon = set('Ogerpon-Wellspring', 'Wellspring Mask', 'Water Absorb', ['Ivy Cudgel', 'Protect']);
    const log = play([wall()], [{ ...ogerpon, teraType: 'Water' }, wall()], [['move softboiled', 'move protect terastallize']]);
    expect(log).toMatch(/\|-ability\|p2a: Ogerpon\|Embody Aspect \(Wellspring\)\|boost/);
    expect(mon(log, 'Ogerpon-Wellspring')?.ability.value ?? '').not.toMatch(/Embody Aspect/);
  });
});

describe('an item a line names from the holder\'s side comes from the client (T108 step 2)', () => {
  test('singles: Toxic Orb poisons its holder at the end of the turn', () => {
    const gliscor = set('Gliscor', 'Toxic Orb', 'Poison Heal', ['Protect', 'Earthquake']);
    const log = play([wall()], [gliscor, wall()], [['move softboiled', 'move protect']]);
    expect(log).toMatch(/\|-status\|p2a: Gliscor\|tox\|\[from\] item: Toxic Orb/);
    expect(mon(log, 'Gliscor')?.item).toEqual({ value: 'Toxic Orb', source: 'revealed' });
  });

  test('doubles: Flame Orb burns its holder at the end of the turn', () => {
    const ursaluna = set('Ursaluna', 'Flame Orb', 'Guts', ['Protect', 'Facade']);
    const log = play([wall(), partner()], [ursaluna, partner(), wall()], [['move softboiled, move softboiled', 'move protect, move protect']], true);
    expect(log).toMatch(/\|-status\|p2a: Ursaluna\|brn\|\[from\] item: Flame Orb/);
    expect(mon(log, 'Ursaluna')?.item).toEqual({ value: 'Flame Orb', source: 'revealed' });
  });

  test('singles: Poltergeist names the target\'s item', () => {
    const dragapult = set('Dragapult', 'Choice Band', 'Clear Body', ['Poltergeist']);
    const target = set('Garchomp', 'Choice Scarf', 'Rough Skin', ['Earthquake', 'Outrage']);
    const log = play([dragapult], [target, wall()], [['move poltergeist', 'move earthquake']]);
    expect(log).toMatch(/\|-activate\|p2a: Garchomp\|move: Poltergeist\|Choice Scarf/);
    expect(mon(log, 'Garchomp')?.item).toEqual({ value: 'Choice Scarf', source: 'revealed' });
  });
});

describe('a move that is no choice of the user\'s own is not its move (T108 step 2)', () => {
  test('singles: a Magic Bounce reflection is not the bouncer\'s move, and Magic Bounce is its ability', () => {
    const setter = set('Garchomp', 'Leftovers', 'Rough Skin', ['Stealth Rock', 'Earthquake']);
    const hatterene = set('Hatterene', 'Leftovers', 'Magic Bounce', ['Draining Kiss', 'Psychic']);
    const log = play([setter], [hatterene, wall()], [['move stealthrock', 'move psychic']]);
    expect(log).toMatch(/\|move\|p2a: Hatterene\|Stealth Rock\|p1a: Garchomp\|\[from\] ability: Magic Bounce/);
    expect(moves(log, 'Hatterene')).toEqual(['Psychic']);
    expect(mon(log, 'Hatterene')?.ability).toEqual({ value: 'Magic Bounce', source: 'revealed' });
  });

  test('doubles: a reflected spread status move is not the bouncer\'s move', () => {
    const setter = set('Amoonguss', 'Sitrus Berry', 'Regenerator', ['Spore', 'Protect']);
    const hatterene = set('Hatterene', 'Leftovers', 'Magic Bounce', ['Draining Kiss', 'Protect']);
    const log = play([setter, partner()], [hatterene, partner(), wall()], [['move spore 1, move protect', 'move drainingkiss 1, move protect']], true);
    expect(log).toMatch(/\|move\|p2a: Hatterene\|Spore\|p1a: Amoonguss\|\[from\] ability: Magic Bounce/);
    expect(moves(log, 'Hatterene')).toEqual(['Draining Kiss']);
  });

  test('singles: Imposter Ditto\'s moves while transformed are not its own', () => {
    const ditto = set('Ditto', 'Choice Scarf', 'Imposter', ['Transform']);
    const target = set('Garchomp', 'Leftovers', 'Rough Skin', ['Earthquake', 'Swords Dance']);
    const log = play([target], [ditto, wall()], [['move swordsdance', 'move earthquake']]);
    expect(log).toMatch(/\|-transform\|p2a: Ditto\|p1a: Garchomp/);
    expect(log).toMatch(/\|move\|p2a: Ditto\|Earthquake/);
    expect(moves(log, 'Ditto')).not.toContain('Earthquake');
  });

  test('Struggle is no move of the set', () => {
    const struggler = set('Toxapex', 'Black Sludge', 'Regenerator', ['Recover']);
    const foe = set('Corviknight', 'Leftovers', 'Pressure', ['Iron Defense']);
    // Recover has 8 PP with PP Ups (a move on the user takes no Pressure PP): Struggle on the ninth turn.
    const turns = Array.from({ length: 9 }, (): [string, string] => ['move irondefense', 'move 1']);
    const log = play([foe], [struggler, wall()], turns);
    expect(log).toMatch(/\|move\|p2a: Toxapex\|Struggle/);
    expect(moves(log, 'Toxapex')).toEqual(['Recover']);
  });
});
