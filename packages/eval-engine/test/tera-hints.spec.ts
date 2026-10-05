import { test, expect, describe } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { combinedOptionHints, singlesOptionHints } from '../src/search/hints';
import { singleMoveFraction } from '../src/score/threat';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 63 (T81, the hint part of T84): a Tera option is hinted on the
 * terastallized body, so its STAB and Tera Blast follow the Tera type. The
 * restriction (singles restrictOptions, the doubles cut to 16) and the MCTS
 * expansion order rank options by these hints.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const option = (choice: string) => ({ choice, label: choice });

describe('Tera options hinted on the terastallized body (round 63, T81)', () => {
  test('singles: a Tera option is hinted on the terastallized body', () => {
    const root = rootOf(battleOf('gen9customgame', [set('Garchomp', ['earthquake', 'terablast'], { teraType: 'Ground' })], [splash('Blissey')]));
    const [quake, teraQuake] = singlesOptionHints(root, 'p1', [option('move earthquake'), option('move earthquake terastallize')]);
    expect(teraQuake / quake).toBeCloseTo(2 / 1.5, 10);
    // Tera Blast after the click: Fairy, physical on Garchomp's Attack, with Tera STAB, as the clicked body prices it.
    const fairyBattle = () => battleOf('gen9customgame', [set('Garchomp', ['terablast'], { teraType: 'Fairy' })], [splash('Dragonite')]);
    const [blast, teraBlast] = singlesOptionHints(rootOf(fairyBattle()), 'p1', [option('move terablast'), option('move terablast terastallize')]);
    const clicked = fairyBattle();
    clicked.choose('p1', 'move 1 terastallize');
    clicked.choose('p2', 'move 1');
    const [garchomp, dragonite] = [clicked.sides[0].active[0], clicked.sides[1].active[0]];
    expect(garchomp.terastallized).toBe('Fairy');
    expect(teraBlast).toBeCloseTo(singleMoveFraction(garchomp, dragonite, 'terablast', clicked), 10);
    expect(teraBlast).toBeGreaterThan(2 * blast);
  });

  test('doubles: the Tera part of a combined option is hinted on the terastallized body', () => {
    const root = rootOf(battleOf('gen9doublescustomgame',
      [set('Garchomp', ['highhorsepower'], { teraType: 'Ground' }), splash('Pikachu')], [splash('Blissey'), splash('Chansey')]));
    const [plain, tera] = combinedOptionHints(root, 'p1', [option('move highhorsepower 1, move splash'), option('move highhorsepower 1 terastallize, move splash')]);
    // The Splash part adds the support floor to both.
    expect((tera - 0.25) / (plain - 0.25)).toBeCloseTo(2 / 1.5, 10);
  });

  test('hinting leaves the body as it was', () => {
    const root = rootOf(battleOf('gen9customgame', [set('Garchomp', ['earthquake'], { teraType: 'Ground' })], [splash('Blissey')]));
    singlesOptionHints(root, 'p1', [option('move earthquake terastallize')]);
    expect(positionBattle(root).sides[0].active[0].terastallized).toBeFalsy();
  });
});
