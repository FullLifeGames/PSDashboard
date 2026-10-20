import { beforeEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { hitReader, playedHit, resetHitMemo, type HitCost } from '../src/score/contact';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T257): the contact-cost memo of score/contact.ts answers one hit for every board that shares the pair's
 * own bodies, the field and the move. The played hit reads more than that: the other actives of the board take part
 * in it (a Ruin ability lowers a stat of every other body on the field, Friend Guard, Power Spot, Helping Hand and the
 * like reach the hit through an ally). The memo lives in every web worker, so a hit's answer came from whichever board
 * reached the worker first, and the evaluation of gen9vgc2026regi-2630685175 turn 1 (Chien-Pao with Sword of Ruin on
 * both sides) changed from run to run in the browser. Here the same two boards are read in both orders: each reading
 * must equal the hit played without a memo, whichever board came first.
 *
 * The abilities come from the Dex: every ability with a handler for an event of another body on the field (onAny,
 * onAlly, onFoe). The sweep runs a physical recoil move (the cost follows the damage) on a doubles board of Scarlet and
 * Violet and of the Champions mod, with the ability on the attacker's partner and on the defender's partner.
 *
 * T257 is open in score/contact.ts (not a file of this step): the test is an expected failure until the key carries the
 * scene; the day it passes, `test.fails` turns red and the marker comes off.
 */

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

  test.fails('a hit read after a board that differs in the other actives is the hit of its own board, in both orders', () => {
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
    // The sweep has teeth: some ability on the field changes the hit's cost.
    expect(reaching.length).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });
});
