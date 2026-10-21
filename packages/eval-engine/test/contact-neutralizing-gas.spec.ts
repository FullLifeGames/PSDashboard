import { beforeEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { hitReader, playedHit, resetHitMemo, type HitCost } from '../src/score/contact';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T225 (round 73), shown with a test and no change to the key: a third body's Neutralizing Gas switches off the
 * defender's contact reactions (Rough Skin, Static) in the simulator, and the contact-cost memo of score/contact.ts
 * keeps it apart, because the scene key of T257 carries place, species, item, ability, status, stages and volatiles of
 * every active other than the pair. The same two boards are read in both orders, on the Dex's reactions that the gas
 * switches off: each reading must equal the hit played without a memo. Doubles only has a third active; a singles board
 * has none, so singles is not affected (one assertion).
 */

await loadSimMods('gen9championscustomgame');

const MOVE = 'crunch';
const FORMATS = ['gen9doublescustomgame', 'gen9championsdoublescustomgame'] as const;

/** The reaction of the defender and the side the gas stands on: next to the attacker, or next to the defender. */
const REACTIONS = ['Rough Skin', 'Static', 'Flame Body'] as const;

function board(format: string, reaction: string, gasOn: 'attacker' | 'defender' | null): Battle {
  const gas = { ability: 'Neutralizing Gas' };
  return battleOf(
    format,
    [set('Cobalion', [MOVE, 'splash']), set('Clefable', ['splash'], gasOn === 'attacker' ? gas : {})],
    [set('Chansey', ['splash'], { ability: reaction }), set('Snorlax', ['splash'], gasOn === 'defender' ? gas : {})],
  );
}

const pair = (battle: Battle): [Pokemon, Pokemon] => [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
const fresh = (battle: Battle): HitCost => playedHit(battle, ...pair(battle), MOVE);
const read = (battle: Battle): HitCost => hitReader(battle)(...pair(battle), MOVE);

beforeEach(() => resetHitMemo());

describe.each(FORMATS)('a third body with Neutralizing Gas (%s)', format => {
  test.each(REACTIONS)('the simulator: %s costs the attacker, and the gas of a third body on either side takes the cost away', reaction => {
    const plain = fresh(board(format, reaction, null));
    expect(plain.chip > 0 || plain.statuses.length > 0, `${reaction} costs the hit`).toBe(true);
    for (const gasOn of ['attacker', 'defender'] as const) {
      expect(fresh(board(format, reaction, gasOn)), `${reaction} with the gas next to the ${gasOn}`).toEqual({ chip: 0, statuses: [] });
    }
  });

  test.each(REACTIONS)('%s: the memo reads the board with the gas and the board without it as their own, in both orders', reaction => {
    for (const gasOn of ['attacker', 'defender'] as const) {
      const boards = { plain: board(format, reaction, null), gas: board(format, reaction, gasOn) };
      const expected = { plain: fresh(boards.plain), gas: fresh(boards.gas) };
      expect(expected.plain).not.toEqual(expected.gas);
      for (const order of [['plain', 'gas'], ['gas', 'plain']] as const) {
        resetHitMemo();
        for (const name of order) expect(read(boards[name]), `${reaction} ${gasOn} ${order.join('>')} reading ${name}`).toEqual(expected[name]);
      }
    }
  });
});

describe('singles', () => {
  test('a singles board has no third active, so the scene key has no body to add (not affected)', () => {
    const battle = battleOf('gen9customgame', [set('Cobalion', [MOVE, 'splash'])], [set('Chansey', ['splash'], { ability: 'Rough Skin' }), set('Snorlax', ['splash'], { ability: 'Neutralizing Gas' })]);
    expect(battle.getAllActive()).toHaveLength(2);
    // The gas on the bench is off the field: the reaction stands.
    expect(fresh(battle).chip).toBeGreaterThan(0);
  });
});
