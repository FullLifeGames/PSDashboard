import { describe, expect, test } from 'vitest';
import type { BranchMoveOption, BranchSimState, BranchSwitchOption } from '@fulllifegames/eval-engine';
import { dropStaleDraft } from '../../../../src/hooks/controller/draft-guard';

const move = (name: string, disabled = false) => ({ name, disabled }) as BranchMoveOption;
const bench = (name: string, species = name, fainted = false) => ({ name, species, fainted }) as BranchSwitchOption;

type Offered = Pick<BranchSimState, 'p1MovesBySlot' | 'p2MovesBySlot' | 'p1SwitchesBySlot' | 'p2SwitchesBySlot'>;

/** Singles: one slot per side. Doubles: two. */
const singles: Offered = {
  p1MovesBySlot: [[move('Waterfall'), move('Roost', true)]], p2MovesBySlot: [[move('Roost')]],
  p1SwitchesBySlot: [[bench('Garchomp'), bench('Toxapex', 'Toxapex', true)]], p2SwitchesBySlot: [[]],
};
const doubles: Offered = {
  p1MovesBySlot: [[move('Shadow Ball')], [move('Giga Drain')]], p2MovesBySlot: [[move('Protect')], [move('Protect')]],
  p1SwitchesBySlot: [[bench('Garchomp')], [bench('Garchomp')]], p2SwitchesBySlot: [[], []],
};

const earthquake = { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' };
const move1 = (name: string) => ({ kind: 'move' as const, moveId: name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: name });

describe('dropStaleDraft (round 77, D2)', () => {
  test('singles: a move the edit removed is dropped, the other pick stays', () => {
    const draft = { p1: [earthquake], p2: [move1('Roost')] };
    expect(dropStaleDraft(draft, singles)).toEqual({ p1: [null], p2: [move1('Roost')] });
  });

  test('singles: a disabled move and a fainted switch target no longer resolve', () => {
    const draft = { p1: [move1('Roost')], p2: [] };
    expect(dropStaleDraft(draft, singles).p1).toEqual([null]);
    const toFainted = { kind: 'switch' as const, speciesId: 'toxapex', pokemonName: 'Toxapex' };
    expect(dropStaleDraft({ p1: [toFainted], p2: [] }, singles).p1).toEqual([null]);
    const toGarchomp = { kind: 'switch' as const, speciesId: 'garchomp', pokemonName: 'Garchomp' };
    const kept = { p1: [toGarchomp], p2: [] };
    expect(dropStaleDraft(kept, singles)).toBe(kept);
  });

  test('doubles: each slot checks its own moves', () => {
    const draft = { p1: [move1('Shadow Ball'), move1('Shadow Ball')], p2: [move1('Protect'), null] };
    expect(dropStaleDraft(draft, doubles)).toEqual({ p1: [move1('Shadow Ball'), null], p2: [move1('Protect'), null] });
  });

  test('a draft that still resolves comes back as the same object', () => {
    const draft = { p1: [move1('Waterfall')], p2: [] };
    expect(dropStaleDraft(draft, singles)).toBe(draft);
    const empty = { p1: [], p2: [] };
    expect(dropStaleDraft(empty, singles)).toBe(empty);
  });
});
