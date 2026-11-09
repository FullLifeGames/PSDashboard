import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { planCellEvents } from '../src/cell-blend';
import { openOf, type Cell } from '../src/endgame/prover-order';

// Round 89 (#115): the open class of a forced-win sentence carries the effects that came true (`hit-nokill+brn`,
// `hit-nokill+boosts:spd`); openOf reads its outcome through splitClassKey and splitOutcome, not a split at every colon.

function set(name: string, species: string, moves: string[]): PokemonSet {
  return { name, species, item: '', ability: 'No Ability', moves, nature: 'Serious', gender: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100 };
}

function root(p1: PokemonSet[], p2: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({ formatid: toID(formatid), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const cell = (p1Choice: string, p2Choice: string): Cell => ({ p1Choice, p2Choice }) as Cell;

describe('openOf reads the outcome of a class that carries an effect', () => {
  const scenes = [
    { name: 'a burn', move: 'Flamethrower', id: 'flamethrower', foe: 'Chansey', effect: 'brn' },
    { name: 'a stat drop with a colon of its own', move: 'Psychic', id: 'psychic', foe: 'Chansey', effect: 'boosts:spd' },
  ];
  // The class key joins the order and the outcomes of the cell's events; Soft-Boiled prices no event, so the cell holds one outcome.
  test.each(scenes)('singles: $name', ({ move, id, foe, effect }) => {
    const battle = root([set('Fire', 'Alakazam', [move])], [set('Egg', foe, ['Soft-Boiled'])]);
    const plan = planCellEvents(battle, `move ${id}`, 'move softboiled');
    expect(plan.kind).toBe('events');
    const entry = plan.kind === 'events' ? plan.events[0].secondary?.find(item => item.effectId === effect) : undefined;
    expect(entry).toBeDefined();
    const open = openOf(battle, cell(`move ${id}`, 'move softboiled'), `p1:hit-nokill+${effect}`, 'p1');
    expect(open).toEqual({ side: 'p1', moveId: id, label: move, odds: expect.any(Number), kind: 'kill' });
    // The plain classes keep their reading.
    expect(openOf(battle, cell(`move ${id}`, 'move softboiled'), 'p1:hit-nokill', 'p1')?.kind).toBe('kill');
    expect(openOf(battle, cell(`move ${id}`, 'move softboiled'), 'p1:miss', 'p1')?.kind).toBe('hit');
    expect(openOf(battle, cell(`move ${id}`, 'move softboiled'), 'p1:hit-kill', 'p1')).toBeUndefined();
  });

  // Doubles is not affected: planCellEvents refuses a choice pair with a comma, so no doubles cell carries a class key
  // (prover.ts `sampled`: every doubles cell is proven over sampled rolls) and the sentence names no open class there.
  test('doubles: a cell has no class plan, so there is no open class to name', () => {
    const battle = root(
      [set('Fire', 'Alakazam', ['Flamethrower', 'Protect']), set('Mate', 'Pikachu', ['Protect'])],
      [set('Egg', 'Chansey', ['Soft-Boiled']), set('Egg2', 'Blissey', ['Soft-Boiled'])],
      'gen9doublescustomgame',
    );
    const choice = 'move flamethrower 1, move protect';
    const reply = 'move softboiled, move softboiled';
    expect(planCellEvents(battle, choice, reply).kind).toBe('fail');
    expect(openOf(battle, cell(choice, reply), 'p1:hit-nokill+brn|none', 'p1')).toBeUndefined();
    expect(openOf(battle, cell(choice, reply), 'p1:hit-nokill|none', 'p1')).toBeUndefined();
  });
});
