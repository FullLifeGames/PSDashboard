import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { koOddsForOptions, planCellEvents } from '../src/cell-blend';
import { createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { parsePairChoice } from '../src/pair/guards';
import { rollSet as set, rootOf } from './calc-roll-oracle';

/**
 * Round 67, lane A (T84): a Tera option's kill odds are read on the body the
 * click makes, as the simulator makes it; the reference is a twin of the
 * root where the simulator itself clicked (battle.actions.terastallize).
 * Only the odds read it (ko-odds, cell-blend, pair/odds, pair/snapshot); the
 * hints did so before (search/hints.ts asClicked).
 */

/** A fresh battle of the root whose `side` slot `slot` the simulator has terastallized. */
function clicked(root: SimPosition, side: 0 | 1, slot: number): Battle {
  const twin = positionBattle(createRootPosition(root.serialized));
  twin.actions.terastallize(twin.sides[side].active[slot]!);
  return twin;
}

/** The first defender HP (in steps) where the twin the simulator clicked shows real odds for the option: a kill, not a sure one. */
function rootWithOdds(make: (hp: number) => SimPosition, choice: string): SimPosition {
  for (let hp = 10; hp <= 400; hp += 5) {
    const root = make(hp);
    if (koOddsForOptions(clicked(root, 0, 0), 'p1', [choice])[0]) return root;
  }
  throw new Error('no HP gives the clicked option real odds');
}

const singles = (hp: number) => rootOf('gen9customgame',
  [set('Garchomp', ['Tera Blast', 'Earthquake'], { teraType: 'Fire' })],
  [set('Snorlax', ['Splash'], { ability: 'Battle Armor', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['Splash'])],
  battle => { battle.sides[1].active[0].sethp(hp); });

const ogerpon = (): PokemonSet => set('Ogerpon-Hearthflame', ['Ivy Cudgel', 'Protect'], { ability: 'Mold Breaker', item: 'Hearthflame Mask', teraType: 'Fire' });

describe('Tera options price their odds on the Tera body (T84)', () => {
  test('singles: the Tera Blast Tera option reads the Fire body, as the simulator\'s click makes it', () => {
    const choice = 'move terablast terastallize';
    const root = rootWithOdds(singles, choice);
    const [odds] = koOddsForOptions(positionBattle(root), 'p1', [choice]);
    expect(odds).not.toBeNull();
    expect(odds).toEqual(koOddsForOptions(clicked(root, 0, 0), 'p1', [choice])[0]);
  });

  test('singles: a root cell with a Tera choice plans its event on the Tera body', () => {
    const root = rootWithOdds(singles, 'move terablast terastallize');
    const plan = planCellEvents(positionBattle(root), 'move terablast terastallize', 'move splash');
    expect(plan.kind).toBe('events');
    expect(plan).toEqual(planCellEvents(clicked(root, 0, 0), 'move terablast terastallize', 'move splash'));
  });

  test('singles: a cell where the defender\'s side clicks Tera prices the hit on the defender\'s Tera body, as the turn lands it', () => {
    const at = (hp: number) => rootOf('gen9customgame',
      [set('Garchomp', ['Earthquake'])],
      [set('Snorlax', ['Splash'], { ability: 'Battle Armor', teraType: 'Flying', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } })],
      battle => { battle.sides[1].active[0].sethp(hp); });
    let root = at(1);
    for (let hp = 10; hp <= 260 && planCellEvents(positionBattle(root), 'move earthquake', 'move splash').kind !== 'events'; hp += 5) root = at(hp);
    expect(planCellEvents(positionBattle(root), 'move earthquake', 'move splash').kind).toBe('events');
    const twin = positionBattle(createRootPosition(root.serialized));
    twin.actions.terastallize(twin.sides[1].active[0]!);
    const plan = planCellEvents(positionBattle(root), 'move earthquake', 'move splash terastallize');
    expect(plan).toEqual(planCellEvents(twin, 'move earthquake', 'move splash terastallize'));
    expect(plan).not.toEqual(planCellEvents(positionBattle(root), 'move earthquake', 'move splash'));
  });

  test('singles: without the flag the odds read the body as it stands (the prover and the near-decided stage)', () => {
    const battle = positionBattle(rootWithOdds(singles, 'move terablast terastallize'));
    const [garchomp, snorlax] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const plain = boundaryEvent(battle, garchomp, snorlax, 'terablast');
    expect(plain).toEqual(boundaryEvent(battle, garchomp, snorlax, 'terablast', { attacker: false }));
    expect(plain).not.toEqual(boundaryEvent(battle, garchomp, snorlax, 'terablast', { attacker: true }));
  });

  test('doubles: Ogerpon-Hearthflame\'s Tera Ivy Cudgel reads its -Tera forme and Embody Aspect stage, as the simulator\'s click makes them', () => {
    const choice = 'move ivycudgel 1 terastallize, move roost';
    const root = rootWithOdds(hp => rootOf('gen9doublescustomgame',
      [ogerpon(), set('Corviknight', ['Roost', 'Protect'])],
      [set('Snorlax', ['Splash'], { ability: 'Battle Armor', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['Soft-Boiled'])],
      battle => { battle.sides[1].active[0].sethp(hp); }), choice);
    const battle = positionBattle(root);
    const [odds] = koOddsForOptions(battle, 'p1', [choice]);
    expect(odds).not.toBeNull();
    expect(odds).toEqual(koOddsForOptions(clicked(root, 0, 0), 'p1', [choice])[0]);
    expect(parsePairChoice(battle, 0, choice)).toEqual([
      { kind: 'move', slot: 0, moveId: 'ivycudgel', loc: 1, tera: true },
      { kind: 'move', slot: 1, moveId: 'roost', loc: null },
    ]);
  });
});
