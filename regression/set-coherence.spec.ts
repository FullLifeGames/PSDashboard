import { test, expect, describe } from 'vitest';
import {
  applyCoherenceVetoes, selectCuratedSet,
  type CuratedEvidence, type MoveCandidate,
} from '../packages/replay-core/src/set-coherence';
import type { PokemonSetAssumption } from '../src/lib/smogon-sets';

/**
 * Pairwise coherence vetoes: guessed sets are assembled from independent
 * marginals (top usage moves + top usage item), and the combination is often
 * incoherent even when each part is plausible — SD Cobalion carrying Body
 * Press, Noivern with both Air Slash and Hurricane (GPL). Vetoes apply only
 * to GUESSED entries; revealed/manual knowledge is never second-guessed.
 */

const guessed = (name: string): MoveCandidate => ({ name, guessed: true });
const revealed = (name: string): MoveCandidate => ({ name, guessed: false });
const names = (list: MoveCandidate[]) => list.map(entry => entry.name);

describe('set-coherence vetoes', () => {
  test('a guessed attack the boost does not serve falls (SD Cobalion + Body Press)', () => {
    // Body Press deals physical damage with the DEFENSE stat — Swords Dance
    // does not serve it; the archetypes are disjoint.
    const kept = applyCoherenceVetoes([
      revealed('Swords Dance'), revealed('Iron Head'), guessed('Body Press'), guessed('Stone Edge'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Iron Head', 'Stone Edge']);
  });

  test('a revealed off-stat attack always survives', () => {
    const kept = applyCoherenceVetoes([
      revealed('Swords Dance'), revealed('Body Press'), guessed('Stone Edge'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Body Press', 'Stone Edge']);
  });

  test('an orphaned defense-boost fill falls with its vetoed payoff (Iron Defense)', () => {
    // GPL Cobalion: usage ranks Iron Defense high BECAUSE of Body Press.
    // Row 1 already drops Body Press next to the revealed Swords Dance —
    // the enabler must not stay behind without any Defense-scaling attack.
    const kept = applyCoherenceVetoes([
      revealed('Swords Dance'), revealed('Heavy Slam'),
      guessed('Body Press'), guessed('Iron Defense'), guessed('Thunder Wave'), guessed('Stone Edge'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Heavy Slam', 'Thunder Wave', 'Stone Edge']);
  });

  test('a defense-boost with its payoff attack survives', () => {
    const kept = applyCoherenceVetoes([
      revealed('Body Press'), guessed('Iron Defense'), guessed('Stone Edge'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Body Press', 'Iron Defense', 'Stone Edge']);
  });

  test('a revealed defense-boost is never second-guessed', () => {
    const kept = applyCoherenceVetoes([
      revealed('Iron Defense'), guessed('Stone Edge'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Iron Defense', 'Stone Edge']);
  });

  test('Nasty Plot vetoes big guessed physical attacks but spares utility and pivots', () => {
    const kept = applyCoherenceVetoes([
      guessed('Nasty Plot'), guessed('Play Rough'), guessed('Knock Off'), guessed('U-turn'), guessed('Shadow Ball'),
    ], { itemId: '' });
    // Play Rough (90 BP physical) contradicts the special boost; Knock Off is
    // sub-70-BP utility and U-turn is a pivot — both stay.
    expect(names(kept)).toEqual(['Nasty Plot', 'Knock Off', 'U-turn', 'Shadow Ball']);
  });

  test('a guessed damaging move sharing a type with the set is redundant (Noivern)', () => {
    const kept = applyCoherenceVetoes([
      revealed('Hurricane'), guessed('Air Slash'), guessed('Boomburst'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Hurricane', 'Boomburst']);
  });

  test('two guessed same-type attacks keep the higher-usage first', () => {
    const kept = applyCoherenceVetoes([
      guessed('Air Slash'), guessed('Hurricane'), guessed('Draco Meteor'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Air Slash', 'Draco Meteor']);
  });

  test('typed STATUS moves never block a same-type attack', () => {
    const kept = applyCoherenceVetoes([
      revealed('Roost'), guessed('Air Slash'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Roost', 'Air Slash']);
  });

  test('a choice item vetoes guessed status moves except the Trick family', () => {
    const kept = applyCoherenceVetoes([
      guessed('Draco Meteor'), guessed('Protect'), guessed('Trick'), guessed('Roost'),
    ], { itemId: 'choicescarf' });
    expect(names(kept)).toEqual(['Draco Meteor', 'Trick']);
  });

  test('revealed status moves survive a guessed choice item', () => {
    // The guessed ITEM is the weaker knowledge — proof beats fills.
    const kept = applyCoherenceVetoes([
      revealed('Protect'), guessed('Draco Meteor'),
    ], { itemId: 'choicescarf' });
    expect(names(kept)).toEqual(['Protect', 'Draco Meteor']);
  });

  test('Assault Vest vetoes every guessed status move including Trick', () => {
    const kept = applyCoherenceVetoes([
      guessed('Knock Off'), guessed('Trick'), guessed('Substitute'),
    ], { itemId: 'assaultvest' });
    expect(names(kept)).toEqual(['Knock Off']);
  });

  test('no boosts, no restrictive item — nothing vetoed', () => {
    const pool = [revealed('Tackle'), guessed('Protect'), guessed('Shadow Ball')];
    expect(names(applyCoherenceVetoes(pool, { itemId: 'leftovers' }))).toEqual([
      'Tackle', 'Protect', 'Shadow Ball',
    ]);
  });

  test('a boost later in the pool still vetoes an earlier off-stat guess', () => {
    // Usage order can list the attack first; the veto scans the whole pool
    // for boost context before deciding.
    const kept = applyCoherenceVetoes([
      guessed('Body Press'), revealed('Swords Dance'), guessed('Iron Head'),
    ], { itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Iron Head']);
  });
});

describe('coherent-set selection', () => {
  const set = (moves: string[], item?: string): PokemonSetAssumption => ({
    species: 'Noivern', sourceDetail: 't',
    moves: moves.map(value => ({ value, sourceDetail: 't' })),
    ...(item ? { item: { value: item, sourceDetail: 't' } } : {}),
  });
  const evidence = (over: Partial<CuratedEvidence>): CuratedEvidence => ({
    revealedMoves: [], revealedItem: '', revealedAbility: '',
    ruledOutItems: [], ruledOutAbilities: [],
    usageProbability: () => 0.5,
    ...over,
  });
  const specs = () => set(['Draco Meteor', 'Hurricane', 'Flamethrower', 'U-turn'], 'Choice Specs');
  const utility = () => set(['Super Fang', 'Taunt', 'Roost', 'Hurricane'], 'Heavy-Duty Boots');

  test('a revealed move picks the matching set over the first-listed one', () => {
    const boots = utility();
    expect(selectCuratedSet([specs(), boots], evidence({ revealedMoves: ['superfang'] }))).toBe(boots);
  });

  test('a rule-out disqualifies the set outright', () => {
    const boots = utility();
    expect(selectCuratedSet([specs(), boots], evidence({ ruledOutItems: ['choicespecs'] }))).toBe(boots);
  });

  test('sets contradicting the revealed moves fall below the floor', () => {
    expect(selectCuratedSet([specs(), utility()], evidence({
      revealedMoves: ['tackle', 'protect'],
    }))).toBeNull();
  });

  test('with no evidence the usage marginals break the tie', () => {
    const first = specs();
    const second = utility();
    const picked = selectCuratedSet([first, second], evidence({
      usageProbability: moveId => (moveId === 'superfang' || moveId === 'taunt' || moveId === 'roost' ? 0.9 : 0.05),
    }));
    expect(picked).toBe(second);
  });

  test('a revealed item counts toward the fit', () => {
    const boots = utility();
    // Hurricane matches both sets; the revealed Boots break the tie by fit.
    expect(selectCuratedSet([specs(), boots], evidence({
      revealedMoves: ['hurricane'], revealedItem: 'heavydutyboots',
    }))).toBe(boots);
  });
});
