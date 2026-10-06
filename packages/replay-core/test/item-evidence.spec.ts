import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';

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

/** The spectators' log: each `|split|` keeps its public line, as a replay does. */
function play(p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false, gen = 9): string {
  const battle = new Battle({
    formatid: toID(doubles ? `gen${gen}doublescustomgame` : `gen${gen}customgame`), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
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
