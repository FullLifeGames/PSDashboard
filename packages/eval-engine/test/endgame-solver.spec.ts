import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { advancePosition, createRootPosition, positionBattle } from '../src/forward-model';
import { endgameKey } from '../src/endgame/key';
import { endgameChildren } from '../src/endgame/children';
import { searchOptions } from '../src/search/options';

function makeSet(
  name: string,
  species: string,
  moves: string[],
  level = 100,
  extras: { item?: string; ability?: string } = {},
): PokemonSet {
  return {
    name, species, item: extras.item ?? '', ability: extras.ability ?? 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle));

test.describe('endgame key (round 34)', () => {
  test('two move orders reaching the same board share one key, different PP do not', () => {
    // Setup moves without chance: Iron Defense, Swords Dance, Swords Dance
    // equals Swords Dance, Iron Defense, Swords Dance (same PP, same
    // boosts, same last move, which stays in the key because Choice lock,
    // Encore, and Torment read it); seeds differ on purpose so the key
    // provably ignores the PRNG, the turn counter, and the log.
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Scizor', 'Scizor', ['Swords Dance', 'Iron Defense'])],
      [makeSet('Magikarp', 'Magikarp', ['Splash'])],
    )));
    const walk = (moves: string[], seeds: PRNGSeed[]) => moves.reduce(
      (position, move, index) => advancePosition(position, `move ${move}`, 'move splash', seeds[index]),
      root,
    );
    const pathA = walk(['irondefense', 'swordsdance', 'swordsdance'], ['1,2,3,4', '5,6,7,8', '9,10,11,12']);
    const pathB = walk(['swordsdance', 'irondefense', 'swordsdance'], ['13,14,15,16', '17,18,19,20', '21,22,23,24']);
    const pathC = walk(['swordsdance', 'swordsdance', 'swordsdance'], ['1,2,3,4', '5,6,7,8', '9,10,11,12']);
    expect(endgameKey(positionBattle(pathA))).toBe(endgameKey(positionBattle(pathB)));
    expect(endgameKey(positionBattle(pathA))).not.toBe(endgameKey(positionBattle(pathC)));
    expect(endgameKey(positionBattle(pathA))).not.toBe(endgameKey(positionBattle(root)));
  });
});

test.describe('endgame children (round 34)', () => {
  test('a deterministic pair yields one child with weight 1 and no unpriced flag', () => {
    // Chansey, not Blissey: Blissey ties Machamp on base speed, which is a
    // priced order split of its own (the next tests cover it).
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
    )));
    const { children, unpriced } = endgameChildren(root, 'move seismictoss', 'move softboiled');
    expect(children).toHaveLength(1);
    expect(children[0].weight).toBe(1);
    expect(unpriced).toBe(false);
  });
  test('an accuracy roll on a kill splits into miss and hit-kill children with analytic weights', () => {
    const battle = makeBattle(
      [makeSet('Jolt', 'Jolteon', ['Thunder'])],
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
    );
    // Both at 1 HP: Thunder kills on a hit (70 %), Close Combat kills for
    // sure after a miss, so the cell has exactly two classes.
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const { children, unpriced } = endgameChildren(createRootPosition(serialize(battle)), 'move thunder', 'move closecombat');
    expect(unpriced).toBe(false);
    const weights = children.map(child => child.weight).sort((a, b) => a - b);
    expect(weights[0]).toBeCloseTo(0.3, 6);
    expect(weights[1]).toBeCloseTo(0.7, 6);
    expect(children.some(child => child.ended)).toBe(true);
  });
  test('a singles speed tie splits the cell into two order classes of one half each', () => {
    const battle = makeBattle(
      [makeSet('A', 'Machamp', ['Close Combat'])],
      [makeSet('B', 'Machamp', ['Close Combat'])],
    );
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const { children, unpriced } = endgameChildren(createRootPosition(serialize(battle)), 'move closecombat', 'move closecombat');
    expect(unpriced).toBe(false);
    expect(children.map(child => child.weight)).toEqual([0.5, 0.5]);
    const winners = children.map(child => positionBattle(child.position).winner);
    expect(new Set(winners)).toEqual(new Set(['Alpha', 'Beta']));
  });
  test('doubles cells take the plain path and flag unpriced only when the draws disagree on a KO', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Pika', 'Pikachu', ['Tackle'], 5)],
      [makeSet('Blob', 'Blissey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    for (const side of battle.sides) side.active[1]!.faint();
    battle.faintMessages();
    const root = createRootPosition(serialize(battle));
    // The first legal option of each side: the solver uses searchOptions, the test only needs one valid pair.
    const p1Choice = searchOptions(root, 'p1', { tera: false })[0].choice;
    const p2Choice = searchOptions(root, 'p2', { tera: false })[0].choice;
    const { children, unpriced } = endgameChildren(root, p1Choice, p2Choice);
    expect(children).toHaveLength(1);
    expect(unpriced).toBe(false);
  });
});
