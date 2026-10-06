import { test, expect, describe } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { contactLands } from '../src/inference/item-evidence';

/**
 * Items the protocol rules out by a line it does NOT show (round 63, T80).
 * Every log here comes from @pkmn/sim, so the simulator, not a hand-kept
 * list, says what a holder shows: each case first checks the sim fact, then
 * what the inference reads from the same log for the side p2.
 */

function set(species: string, item: string, ability: string, moves: string[], level = 100): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Hardy', level, gender: '',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

/**
 * The spectators' log: each `|split|` keeps its public line, as a replay does.
 * `format` names a format whose rules fix the abilities (OU); the default
 * custom game lets any species hold any ability.
 */
function play(p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false, gen = 9, format = 'customgame'): string {
  const battle = new Battle({
    formatid: toID(doubles ? `gen${gen}doubles${format}` : `gen${gen}${format}`), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  for (const [p1Choice, p2Choice] of turns) {
    battle.choose('p1', p1Choice);
    battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const ruledOut = (log: string, species: string) =>
  inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species)?.ruledOut?.items ?? [];
const wall = () => set('Mew', '', 'Synchronize', ['Recover', 'Psychic Noise', 'Tackle']);
const shown = (log: string, item: string) => log.includes(`[from] item: ${item}`);

describe('Life Orb shows its recoil on every hit (T80)', () => {
  test('singles: a damaging hit without the recoil rules Life Orb out', () => {
    const attacker = (item: string) => [set('Garchomp', item, 'Rough Skin', ['Earthquake'], 50)];
    expect(shown(play([wall()], attacker('Life Orb'), [['move recover', 'move earthquake']]), 'Life Orb')).toBe(true);
    const log = play([wall()], attacker('Expert Belt'), [['move recover', 'move earthquake']]);
    expect(ruledOut(log, 'Garchomp')).toContain('lifeorb');
  });

  test('doubles: a spread move without the recoil rules Life Orb out', () => {
    const attacker = (item: string) => [set('Garchomp', item, 'Rough Skin', ['Earthquake', 'Protect'], 50), set('Talonflame', '', 'Gale Wings', ['Roost'])];
    const p1 = [wall(), set('Blissey', '', 'Natural Cure', ['Soft-Boiled'])];
    const turn: [string, string] = ['move recover, move softboiled', 'move earthquake, move roost'];
    expect(shown(play(p1, attacker('Life Orb'), [turn], true), 'Life Orb')).toBe(true);
    expect(ruledOut(play(p1, attacker('Expert Belt'), [turn], true), 'Garchomp')).toContain('lifeorb');
  });

  test('Sheer Force on a move with a secondary effect hides the recoil: nothing is ruled out', () => {
    const log = play([wall()], [set('Nidoking', 'Life Orb', 'Sheer Force', ['Earth Power'], 50)], [['move recover', 'move earthpower']]);
    expect(shown(log, 'Life Orb')).toBe(false);
    expect(ruledOut(log, 'Nidoking')).not.toContain('lifeorb');
  });

  test('Magic Guard hides the recoil: nothing is ruled out while it is possible', () => {
    const log = play([wall()], [set('Clefable', 'Life Orb', 'Magic Guard', ['Moonblast'], 50)], [['move recover', 'move moonblast']]);
    expect(shown(log, 'Life Orb')).toBe(false);
    expect(ruledOut(log, 'Clefable')).not.toContain('lifeorb');
  });

  test('an attacker that faints in its own hit is not judged', () => {
    const boom = (item: string) => play([wall()], [set('Electrode', item, 'Static', ['Explosion'], 50)], [['move recover', 'move explosion']]);
    expect(shown(boom('Life Orb'), 'Life Orb')).toBe(false);
    const log = boom('Expert Belt');
    expect(log).toMatch(/\|faint\|p2a: Electrode/);
    expect(ruledOut(log, 'Electrode')).not.toContain('lifeorb');
  });
});

describe('Leftovers and Black Sludge show their heal below full HP (T80)', () => {
  const tank = (item: string) => set('Snorlax', item, 'Thick Fat', ['Curse', 'Protect']);
  const hitter = () => set('Machamp', '', 'No Guard', ['Close Combat', 'Bulk Up'], 50);

  test('singles: a turn end below full HP without the heal rules both out', () => {
    expect(shown(play([hitter()], [tank('Leftovers')], [['move closecombat', 'move curse']]), 'Leftovers')).toBe(true);
    const log = play([hitter()], [tank('Expert Belt')], [['move closecombat', 'move curse']]);
    expect(ruledOut(log, 'Snorlax')).toEqual(expect.arrayContaining(['leftovers', 'blacksludge']));
  });

  test('doubles: a turn end below full HP without the heal rules both out', () => {
    const p1 = [hitter(), set('Blissey', '', 'Natural Cure', ['Soft-Boiled'])];
    const p2 = (item: string) => [tank(item), set('Talonflame', '', 'Gale Wings', ['Roost'])];
    const turn: [string, string] = ['move closecombat 1, move softboiled', 'move curse, move roost'];
    expect(shown(play(p1, p2('Leftovers'), [turn], true), 'Leftovers')).toBe(true);
    expect(ruledOut(play(p1, p2('Expert Belt'), [turn], true), 'Snorlax')).toEqual(expect.arrayContaining(['leftovers', 'blacksludge']));
  });

  test('full HP or Heal Block rule nothing out', () => {
    const full = play([hitter()], [tank('Expert Belt')], [['move bulkup', 'move curse']]);
    expect(ruledOut(full, 'Snorlax')).not.toContain('leftovers');
    // Psychic Noise blocks healing for two turns: the sim shows no heal, the inference stays out.
    const blocker = set('Mew', '', 'Synchronize', ['Psychic Noise'], 100);
    const blocked = (item: string) => play([blocker], [tank(item)], [['move psychicnoise', 'move curse']]);
    expect(shown(blocked('Leftovers'), 'Leftovers')).toBe(false);
    expect(ruledOut(blocked('Expert Belt'), 'Snorlax')).not.toContain('leftovers');
  });
});

describe('Illusion hides who stands on the field (round 63 review, issue 2)', () => {
  test('a side that may hold an Illusion user rules nothing out by absence (Zoroark-Hisui as Dondozo)', () => {
    // Zoroark-Hisui (Choice Specs) takes the shape of the last party member:
    // the log names Dondozo while the sand chips it and its Shadow Balls land.
    const sand = set('Tyranitar', '', 'Sand Stream', ['Calm Mind']);
    const zoroark = set('Zoroark-Hisui', 'Choice Specs', 'Illusion', ['Shadow Ball'], 50);
    const dondozo = set('Dondozo', 'Leftovers', 'Unaware', ['Rest']);
    const log = play([sand], [zoroark, dondozo], [['move calmmind', 'move shadowball'], ['move calmmind', 'move shadowball']]);
    expect(log).toMatch(/\|switch\|p2a: Dondozo\|Dondozo/);
    expect(log).toMatch(/\|-damage\|p2a: Dondozo\|\d+\/\d+\|\[from\] Sandstorm/);
    for (const item of ['leftovers', 'blacksludge', 'lifeorb']) expect(ruledOut(log, 'Dondozo')).not.toContain(item);
  });
});

describe('Rocky Helmet shows its damage on every contact hit (T80, decision 13)', () => {
  const holder = (item: string) => set('Skarmory', item, 'Sturdy', ['Roost']);
  const tackle: [string, string][] = [['move tackle', 'move roost']];

  test('gen 6 singles and doubles: a contact hit without the helmet damage rules Rocky Helmet out', () => {
    const attacker = set('Rattata', '', 'Guts', ['Tackle']);
    expect(shown(play([attacker], [holder('Rocky Helmet')], tackle, false, 6), 'Rocky Helmet')).toBe(true);
    expect(ruledOut(play([attacker], [holder('Shed Shell')], tackle, false, 6), 'Skarmory')).toContain('rockyhelmet');
    const p1 = [attacker, set('Blissey', '', 'Natural Cure', ['Soft-Boiled'])];
    const p2 = [holder('Shed Shell'), set('Talonflame', '', 'Gale Wings', ['Roost'])];
    expect(ruledOut(play(p1, p2, [['move tackle 1, move softboiled', 'move roost, move roost']], true, 6), 'Skarmory')).toContain('rockyhelmet');
  });

  test('from the generation of Protective Pads on, an attacker with an unknown item rules nothing out', () => {
    const padded = play([set('Rattata', 'Protective Pads', 'Guts', ['Tackle'])], [holder('Rocky Helmet')], tackle);
    expect(shown(padded, 'Rocky Helmet')).toBe(false);
    expect(ruledOut(padded, 'Skarmory')).not.toContain('rockyhelmet');
    expect(ruledOut(play([set('Rattata', '', 'Guts', ['Tackle'])], [holder('Shed Shell')], tackle), 'Skarmory')).not.toContain('rockyhelmet');
  });
});

describe('Rocky Helmet from the generation of Protective Pads on (round 64, T120, decision 19)', () => {
  const holder = (item: string, ability = 'Sturdy') => set('Skarmory', item, ability, ['Knock Off', 'Roost']);
  const ou = (p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false, gen = 9) =>
    play(p1, p2, turns, doubles, gen, 'ou');

  test('singles gen 9: an attacker whose Leftovers were knocked off hits without helmet damage: Rocky Helmet ruled out', () => {
    // Turn 1 the attacker's item is unknown when it hits; turn 2 it holds nothing, as the log showed (573756 Melmetal).
    const attacker = set('Rattata', 'Leftovers', 'Guts', ['Tackle']);
    const knocked: [string, string][] = [['move tackle', 'move knockoff'], ['move tackle', 'move roost']];
    expect(shown(ou([attacker], [holder('Rocky Helmet')], knocked), 'Rocky Helmet')).toBe(true);
    const log = ou([attacker], [holder('Shed Shell')], knocked);
    expect(log).toMatch(/\|-enditem\|p1a: Rattata\|Leftovers\|\[from\] move: Knock Off/);
    expect(ruledOut(log, 'Skarmory')).toContain('rockyhelmet');
    expect(ruledOut(ou([attacker], [holder('Shed Shell')], knocked.slice(0, 1)), 'Skarmory')).not.toContain('rockyhelmet');
  });

  test('singles gen 9: an attacker that shows its Life Orb hits without helmet damage: Rocky Helmet ruled out', () => {
    const log = ou([set('Rattata', 'Life Orb', 'Guts', ['Tackle'])], [holder('Shed Shell')], [['move tackle', 'move roost']]);
    expect(shown(log, 'Life Orb')).toBe(true);
    expect(ruledOut(log, 'Skarmory')).toContain('rockyhelmet');
  });

  test('doubles gen 9: an attacker that shows its Life Orb hits without helmet damage: Rocky Helmet ruled out', () => {
    const p1 = [set('Rattata', 'Life Orb', 'Guts', ['Tackle']), set('Blissey', '', 'Natural Cure', ['Soft-Boiled'])];
    const p2 = [holder('Shed Shell'), set('Talonflame', '', 'Gale Wings', ['Roost'])];
    const log = ou(p1, p2, [['move tackle 1, move softboiled', 'move roost, move roost']], true);
    expect(shown(log, 'Life Orb')).toBe(true);
    expect(ruledOut(log, 'Skarmory')).toContain('rockyhelmet');
  });

  test('a punch from a Punching Glove holder makes no contact: nothing is ruled out', () => {
    const glove = set('Hitmonchan', 'Punching Glove', 'Iron Fist', ['Mach Punch', 'Tackle']);
    // Frisk on the holder's side shows the attacker's Punching Glove.
    const frisker = holder('Shed Shell', 'Frisk');
    const punch = ou([glove], [frisker], [['move machpunch', 'move roost']]);
    expect(punch).toMatch(/\|-item\|p1a: Hitmonchan\|Punching Glove\|\[from\] ability: Frisk/);
    expect(ruledOut(punch, 'Skarmory')).not.toContain('rockyhelmet');
    expect(ruledOut(ou([glove], [frisker], [['move tackle', 'move roost']]), 'Skarmory')).toContain('rockyhelmet');
  });

  test('a holder that may have Klutz is not judged (gen 6 Lopunny)', () => {
    const lopunny = set('Lopunny', 'Rocky Helmet', 'Klutz', ['Roost']);
    const log = ou([set('Rattata', '', 'Guts', ['Tackle'])], [lopunny], [['move tackle', 'move roost']], false, 6);
    expect(shown(log, 'Rocky Helmet')).toBe(false);
    expect(ruledOut(log, 'Lopunny')).not.toContain('rockyhelmet');
  });

  test('checker: the contact rule read from the simulator agrees with its battles for every item that modifies a move', () => {
    const items = [...Dex.forGen(9).items.all().filter(item => item.onModifyMove).map(item => item.name), 'Protective Pads', 'Life Orb'];
    for (const item of items) {
      for (const move of ['Mach Punch', 'Tackle']) {
        const log = ou([set('Hitmonchan', item, 'Iron Fist', [move])], [holder('Rocky Helmet')], [[`move ${toID(move)}`, 'move roost']]);
        expect(shown(log, 'Rocky Helmet'), `${item} ${move}`).toBe(contactLands(9, move, toID(item)));
      }
    }
  });
});

describe('Shell Bell heals its holder after a hit below full HP (round 64, T120, decision 19)', () => {
  // Mew moves first and chips the slow attacker, whose hit then shows the heal (or not).
  const chip = () => set('Mew', '', 'Synchronize', ['Tackle', 'Recover', 'Psychic Noise']);
  const slow = (item: string, ability = 'Thick Fat', moves = ['Body Slam']) => set('Snorlax', item, ability, moves);
  const ou = (p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false) => play(p1, p2, turns, doubles, 9, 'ou');

  test('singles: a hit below full HP without the heal rules Shell Bell out', () => {
    expect(shown(ou([chip()], [slow('Shell Bell')], [['move tackle', 'move bodyslam']]), 'Shell Bell')).toBe(true);
    expect(ruledOut(ou([chip()], [slow('Expert Belt')], [['move tackle', 'move bodyslam']]), 'Snorlax')).toContain('shellbell');
  });

  test('doubles: a hit below full HP without the heal rules Shell Bell out', () => {
    const p1 = [chip(), set('Blissey', '', 'Natural Cure', ['Soft-Boiled'])];
    const p2 = (item: string) => [slow(item), set('Talonflame', '', 'Gale Wings', ['Roost'])];
    const turn: [string, string] = ['move tackle 1, move softboiled', 'move bodyslam 1, move roost'];
    expect(shown(ou(p1, p2('Shell Bell'), [turn], true), 'Shell Bell')).toBe(true);
    expect(ruledOut(ou(p1, p2('Expert Belt'), [turn], true), 'Snorlax')).toContain('shellbell');
  });

  test('full HP, Sheer Force on a move with a secondary, or Heal Block rule nothing out', () => {
    const full = ou([chip()], [slow('Expert Belt')], [['move recover', 'move bodyslam']]);
    expect(ruledOut(full, 'Snorlax')).not.toContain('shellbell');
    const force = (item: string) => ou([chip()], [set('Nidoking', item, 'Sheer Force', ['Earth Power'])], [['move tackle', 'move earthpower']]);
    expect(shown(force('Shell Bell'), 'Shell Bell')).toBe(false);
    expect(ruledOut(force('Expert Belt'), 'Nidoking')).not.toContain('shellbell');
    const blocked = (item: string) => ou([chip()], [slow(item)], [['move psychicnoise', 'move bodyslam']]);
    expect(shown(blocked('Shell Bell'), 'Shell Bell')).toBe(false);
    expect(ruledOut(blocked('Expert Belt'), 'Snorlax')).not.toContain('shellbell');
  });
});
