import { test, expect, describe } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { combinedOptionHints, singlesOptionHints } from '../src/search/hints';
import { singleMoveFraction } from '../src/score/threat';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * A Tera option is hinted on the body the
 * simulator makes at the click, not on the body with a Tera type set.
 * Terapagos-Terastal clicks into Terapagos-Stellar (other stats, other HP,
 * Tera Starstorm turns Stellar and, in doubles, hits both foes) and Ogerpon
 * into its -Tera forme with Embody Aspect. The oracle is a battle in which
 * the simulator ran the click (choose with 'terastallize'), as
 * the tera-hints rows below do.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const option = (choice: string) => ({ choice, label: choice });
const SPREAD_FACTOR = 0.75;
const SUPPORT_FLOOR = 0.25;

const TERAPAGOS = (moves: string[]) => set('Terapagos-Terastal', moves, { teraType: 'Stellar', ability: 'Tera Shell' });
const OGERPON = (moves: string[]) => set('Ogerpon-Hearthflame', moves, { teraType: 'Fire', ability: 'Mold Breaker', item: 'Hearthflame Mask' });

describe('Tera hints read the clicked body', () => {
  test('the click changes the forme exactly where the premise says (Terapagos, Ogerpon)', () => {
    const terapagos = battleOf('gen9customgame', [TERAPAGOS(['splash'])], [splash('Blissey')]);
    terapagos.choose('p1', 'move 1 terastallize');
    terapagos.choose('p2', 'move 1');
    expect(terapagos.sides[0].active[0].species.name).toBe('Terapagos-Stellar');
    const ogerpon = battleOf('gen9customgame', [OGERPON(['splash'])], [splash('Blissey')]);
    ogerpon.choose('p1', 'move 1 terastallize');
    ogerpon.choose('p2', 'move 1');
    expect(ogerpon.sides[0].active[0].species.name).toBe('Ogerpon-Hearthflame-Tera');
    expect(ogerpon.sides[0].active[0].boosts.atk).toBe(1);
  });

  test('singles: Tera Starstorm of Terapagos-Terastal is hinted on Terapagos-Stellar', () => {
    const board = () => battleOf('gen9customgame', [TERAPAGOS(['splash', 'terastarstorm'])], [splash('Blissey')]);
    const [plain, tera] = singlesOptionHints(rootOf(board()), 'p1', [option('move terastarstorm'), option('move terastarstorm terastallize')]);
    const clicked = board();
    clicked.choose('p1', 'move 1 terastallize');
    clicked.choose('p2', 'move 1');
    const [mon, foe] = [clicked.sides[0].active[0], clicked.sides[1].active[0]];
    expect(tera).toBeCloseTo(singleMoveFraction(mon, foe, 'terastarstorm', clicked), 10);
    const flagged = board();
    const old = flagged.sides[0].active[0];
    old.terastallized = 'Stellar';
    expect(Math.abs(tera - singleMoveFraction(old, flagged.sides[1].active[0], 'terastarstorm', flagged))).toBeGreaterThan(0.01);
    expect(plain).toBeGreaterThan(0);
  });

  test('doubles: Tera Starstorm of Terapagos-Terastal is hinted as the spread move of Terapagos-Stellar', () => {
    const board = () => battleOf('gen9doublescustomgame',
      [TERAPAGOS(['splash', 'terastarstorm']), splash('Pikachu')], [splash('Blissey'), splash('Chansey')]);
    const [plain, tera] = combinedOptionHints(rootOf(board()), 'p1',
      [option('move terastarstorm 1, move splash'), option('move terastarstorm 1 terastallize, move splash')]);
    const clicked = board();
    clicked.choose('p1', 'move 1 terastallize, move 1');
    clicked.choose('p2', 'move 1, move 1');
    const mon = clicked.sides[0].active[0];
    expect(mon.species.name).toBe('Terapagos-Stellar');
    // The clicked body's move hits both foes: the target is the simulator's, read from the clicked Terapagos-Stellar.
    const spread = clicked.sides[1].active.reduce((sum, foe) => sum + singleMoveFraction(mon, foe!, 'terastarstorm', clicked), 0) * SPREAD_FACTOR;
    expect(tera - SUPPORT_FLOOR).toBeCloseTo(spread, 10);
    expect(tera).toBeGreaterThan(plain);
  });

  test('doubles: a Terapagos-Stellar already on the field hints Tera Starstorm as a spread move', () => {
    const board = () => {
      const battle = battleOf('gen9doublescustomgame',
        [TERAPAGOS(['splash', 'terastarstorm']), splash('Pikachu')], [splash('Blissey'), splash('Chansey')]);
      battle.choose('p1', 'move 1 terastallize, move 1');
      battle.choose('p2', 'move 1, move 1');
      return battle;
    };
    const battle = board();
    const mon = battle.sides[0].active[0];
    const [hint] = combinedOptionHints(rootOf(battle), 'p1', [option('move terastarstorm 1, move splash')]);
    const spread = battle.sides[1].active.reduce((sum, foe) => sum + singleMoveFraction(mon, foe!, 'terastarstorm', battle), 0) * SPREAD_FACTOR;
    expect(hint - SUPPORT_FLOOR).toBeCloseTo(spread, 10);
  });

  test('Ogerpon: the Tera option is hinted on the Tera forme the simulator makes (singles and doubles)', () => {
    const singlesBoard = () => battleOf('gen9customgame', [OGERPON(['splash', 'ivycudgel'])], [splash('Blissey')]);
    const [, singlesHint] = singlesOptionHints(rootOf(singlesBoard()), 'p1', [option('move ivycudgel'), option('move ivycudgel terastallize')]);
    const clicked = singlesBoard();
    clicked.choose('p1', 'move 1 terastallize');
    clicked.choose('p2', 'move 1');
    expect(singlesHint).toBeCloseTo(singleMoveFraction(clicked.sides[0].active[0], clicked.sides[1].active[0], 'ivycudgel', clicked), 10);

    const doublesBoard = () => battleOf('gen9doublescustomgame',
      [OGERPON(['splash', 'ivycudgel']), splash('Pikachu')], [splash('Blissey'), splash('Chansey')]);
    const [, doublesHint] = combinedOptionHints(rootOf(doublesBoard()), 'p1',
      [option('move ivycudgel 1, move splash'), option('move ivycudgel 1 terastallize, move splash')]);
    const doublesClicked = doublesBoard();
    doublesClicked.choose('p1', 'move 1 terastallize, move 1');
    doublesClicked.choose('p2', 'move 1, move 1');
    const mon = doublesClicked.sides[0].active[0];
    expect(doublesHint - SUPPORT_FLOOR).toBeCloseTo(singleMoveFraction(mon, doublesClicked.sides[1].active[0], 'ivycudgel', doublesClicked), 10);
  });

  test('a click that keeps the forme prices as before (singles and doubles)', () => {
    const singlesBoard = () => battleOf('gen9customgame', [set('Garchomp', ['splash', 'terablast'], { teraType: 'Fairy' })], [splash('Dragonite')]);
    const [, singlesHint] = singlesOptionHints(rootOf(singlesBoard()), 'p1', [option('move terablast'), option('move terablast terastallize')]);
    const clicked = singlesBoard();
    clicked.choose('p1', 'move 1 terastallize');
    clicked.choose('p2', 'move 1');
    expect(singlesHint).toBeCloseTo(singleMoveFraction(clicked.sides[0].active[0], clicked.sides[1].active[0], 'terablast', clicked), 10);

    const doublesBoard = () => battleOf('gen9doublescustomgame',
      [set('Garchomp', ['splash', 'terablast'], { teraType: 'Fairy' }), splash('Pikachu')], [splash('Dragonite'), splash('Chansey')]);
    const [, doublesHint] = combinedOptionHints(rootOf(doublesBoard()), 'p1',
      [option('move terablast 1, move splash'), option('move terablast 1 terastallize, move splash')]);
    const doublesClicked = doublesBoard();
    doublesClicked.choose('p1', 'move 1 terastallize, move 1');
    doublesClicked.choose('p2', 'move 1, move 1');
    expect(doublesHint - SUPPORT_FLOOR)
      .toBeCloseTo(singleMoveFraction(doublesClicked.sides[0].active[0], doublesClicked.sides[1].active[0], 'terablast', doublesClicked), 10);
  });

  test('hinting a forme-changing click leaves the position as it was', () => {
    const root = rootOf(battleOf('gen9customgame', [TERAPAGOS(['splash', 'terastarstorm'])], [splash('Blissey')]));
    singlesOptionHints(root, 'p1', [option('move terastarstorm terastallize')]);
    const mon = positionBattle(root).sides[0].active[0];
    expect(mon.terastallized).toBeFalsy();
    expect(mon.species.name).toBe('Terapagos-Terastal');
  });
});

describe('Tera options hinted on the terastallized body', () => {
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

  // Each Tera part is held against the static of a body the simulator terastallized
  // (a STAB constant would pass whether or not the part was hinted on the clicked
  // body); the Tera Blast row moves type and category under any STAB rule.
  test('doubles: the Tera part of a combined option is hinted on the terastallized body', () => {
    // Tera Blast turns Fairy and physical under any STAB rule; High Horsepower moves with the STAB rule only.
    const rows = [['Ground', 'highhorsepower', 'Blissey', false], ['Fairy', 'terablast', 'Dragonite', true]] as const;
    for (const [teraType, move, foe, movesUnderAnyRule] of rows) {
      const board = () => battleOf('gen9doublescustomgame',
        [set('Garchomp', ['splash', move], { teraType }), splash('Pikachu')], [splash(foe), splash('Chansey')]);
      const unclicked = board();
      const [plain, tera] = combinedOptionHints(rootOf(unclicked), 'p1', [option(`move ${move} 1, move splash`), option(`move ${move} 1 terastallize, move splash`)]);
      const clicked = board();
      clicked.choose('p1', 'move 1 terastallize, move 1');
      clicked.choose('p2', 'move 1, move 1');
      const garchomp = clicked.sides[0].active[0];
      expect(garchomp.terastallized).toBe(teraType);
      expect(plain - 0.25).toBeCloseTo(singleMoveFraction(unclicked.sides[0].active[0], unclicked.sides[1].active[0], move, unclicked), 10);
      expect(tera - 0.25).toBeCloseTo(singleMoveFraction(garchomp, clicked.sides[1].active[0], move, clicked), 10);
      if (movesUnderAnyRule) expect(tera - plain).toBeGreaterThan(0.05);
    }
  });

  test('hinting leaves the body as it was', () => {
    const root = rootOf(battleOf('gen9customgame', [set('Garchomp', ['earthquake'], { teraType: 'Ground' })], [splash('Blissey')]));
    singlesOptionHints(root, 'p1', [option('move earthquake terastallize')]);
    expect(positionBattle(root).sides[0].active[0].terastallized).toBeFalsy();
  });
});
