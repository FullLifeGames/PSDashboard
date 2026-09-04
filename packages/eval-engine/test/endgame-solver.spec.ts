import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { advancePosition, createRootPosition, positionBattle } from '../src/forward-model';
import { endgameKey } from '../src/endgame/key';

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
