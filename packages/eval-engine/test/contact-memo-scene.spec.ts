import { beforeEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { hitReader, playedHit, resetHitMemo, type HitCost } from '../src/score/contact';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

// The played hit also reads the other actives (Ruin abilities, Friend Guard, Power Spot, Helping Hand).

await loadSimMods('gen9championscustomgame');

const FORMATS = ['gen9doublescustomgame', 'gen9championsdoublescustomgame'] as const;
const MOVE = 'woodhammer';
const REACHING = /^on(Any|Ally|Foe)/;

const board = (format: string, holder: 'ally' | 'foe', ability: string): Battle => battleOf(
  format,
  [set('Rillaboom', [MOVE, 'splash']), set('Clefable', ['splash'], holder === 'ally' ? { ability } : {})],
  [set('Dragonite', ['splash']), set('Snorlax', ['splash'], holder === 'foe' ? { ability } : {})],
);

const pair = (battle: Battle): [Pokemon, Pokemon] => [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
const fresh = (battle: Battle): HitCost => playedHit(battle, ...pair(battle), MOVE);
const read = (battle: Battle): HitCost => hitReader(battle)(...pair(battle), MOVE);

beforeEach(() => resetHitMemo());

describe.each(FORMATS)('the contact memo reads the scene of the hit (%s)', format => {
  const abilities = board(format, 'ally', 'No Ability').dex.abilities.all()
    .filter(ability => !ability.isNonstandard && Object.keys(ability).some(key => REACHING.test(key)))
    .map(ability => ability.id);

  test('a hit read after a board that differs in the other actives is the hit of its own board, in both orders', () => {
    const reaching: string[] = [];
    const wrong: string[] = [];
    for (const holder of ['ally', 'foe'] as const) {
      for (const ability of abilities) {
        const plain = board(format, holder, 'No Ability');
        const withAbility = board(format, holder, ability);
        const expected = { plain: fresh(plain), withAbility: fresh(withAbility) };
        if (JSON.stringify(expected.plain) === JSON.stringify(expected.withAbility)) continue;
        reaching.push(`${holder}:${ability}`);
        for (const order of [['plain', 'withAbility'], ['withAbility', 'plain']] as const) {
          resetHitMemo();
          const boards = { plain, withAbility };
          for (const name of order) {
            if (JSON.stringify(read(boards[name])) !== JSON.stringify(expected[name])) wrong.push(`${holder}:${ability} ${order.join('>')}`);
          }
        }
      }
    }
    expect(reaching.length).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });
});
