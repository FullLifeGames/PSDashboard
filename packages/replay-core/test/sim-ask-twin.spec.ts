import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { twinBattle } from '../src/sim-ask/twin';
import { twinBattle as exported } from '../src/index';

/**
 * Round 72 (T239): the twin battle the callers ask the simulator on, built once. A twin is a one-body battle (or a
 * 2v1 with a benched body) past team preview, on the custom game of a generation, seeded 1,2,3,4. The six callers
 * built it by hand with the same lines; this spec holds the factory to those lines.
 */

const SET: PokemonSet = {
  name: 'Probe', species: 'Smeargle', item: '', ability: 'Own Tempo', moves: ['splash', 'tackle'], nature: 'Hardy',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
};

/** The old hand-written lines of the callers (race-speed, tera-click, boost-bite, status-factor, snapshot-move-types). */
function byHand(format: string, p1: PokemonSet[], p2: PokemonSet[], names: [string, string], seed = '1,2,3,4'): Battle {
  const battle = new Battle({
    formatid: toID(format), seed: seed as never,
    p1: { name: names[0], team: Teams.pack(p1) }, p2: { name: names[1], team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const identity = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle));

describe('twinBattle', () => {
  test('is the one export of the barrel', () => {
    expect(exported).toBe(twinBattle);
  });

  for (const gen of [1, 3, 5, 9]) {
    test(`gen ${gen}: a 1v1 twin is the battle the callers built by hand`, () => {
      const format = `gen${gen}customgame`;
      const made = twinBattle(format, { p1: { name: 'Body', team: [SET] }, p2: { name: 'Foe', team: [SET] } });
      expect(identity(made)).toBe(identity(byHand(format, [SET], [SET], ['Body', 'Foe'])));
      expect(made.sides[0].active[0]?.species.name).toBe('Smeargle');
      expect(made.sides.some(side => side.requestState === 'teampreview')).toBe(false);
    });
  }

  test('a benched 2v1 takes both bodies to the field in team order', () => {
    const second = { ...SET, name: 'Second', species: 'Chansey', ability: 'Natural Cure' };
    const made = twinBattle('gen9customgame', { p1: { name: 'Target', team: [SET, second] }, p2: { name: 'Foe', team: [SET] } });
    expect(identity(made)).toBe(identity(byHand('gen9customgame', [SET, second], [SET], ['Target', 'Foe'])));
    expect(made.sides[0].pokemon.map(mon => mon.species.name)).toEqual(['Smeargle', 'Chansey']);
  });

  test('a seed is passed on, and a choice other than the default is taken', () => {
    const second = { ...SET, name: 'Second', species: 'Chansey', ability: 'Natural Cure' };
    const made = twinBattle(
      'gen9customgame', { p1: { name: 'A', team: [SET, second] }, p2: { name: 'B', team: [SET] } },
      { seed: '5,6,7,8', preview: { p1: 'team 21', p2: 'team 1' } },
    );
    expect(made.sides[0].active[0]?.species.name).toBe('Chansey');
    expect(made.prng.getSeed()).not.toEqual(twinBattle('gen9customgame', { p1: { name: 'A', team: [SET] }, p2: { name: 'B', team: [SET] } }).prng.getSeed());
  });

  test('preview false builds the battle and leaves the preview to the caller', () => {
    const made = twinBattle('gen9customgame', { p1: { name: 'A', team: [SET] }, p2: { name: 'B', team: [SET] } }, { preview: false });
    const bare = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4' as never,
      p1: { name: 'A', team: Teams.pack([SET]) }, p2: { name: 'B', team: Teams.pack([SET]) },
    });
    expect(identity(made)).toBe(identity(bare));
  });

  test('a team the simulator cannot build throws as the simulator does', () => {
    expect(() => byHand('gen3customgame', [], [SET], ['A', 'B'])).toThrow();
    expect(() => twinBattle('gen3customgame', { p1: { name: 'A', team: [] }, p2: { name: 'B', team: [SET] } })).toThrow();
  });
});
