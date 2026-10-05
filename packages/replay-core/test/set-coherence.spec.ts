import { test, expect, describe } from 'vitest';
import {
  applyCoherenceVetoes, selectCuratedSet,
  type CuratedEvidence, type MoveCandidate,
} from '../src/set-coherence';
import type { PokemonSetAssumption } from '../src/smogon/sets-lookup';

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

  // T89 (round 63): Smogon publishes slots with alternatives; the build must
  // read a slot as filled once one option is seen, and never trade a fixed
  // move for a second option of a filled slot (648453 Tornadus-T).
  const slotted = (moves: (string | string[])[], item?: string): PokemonSetAssumption => ({
    species: 'Tornadus-Therian', sourceDetail: 't',
    moves: moves.map(slot => Array.isArray(slot)
      ? { value: slot[0], sourceDetail: 't', options: slot }
      : { value: slot, sourceDetail: 't' }),
    ...(item ? { item: { value: item, sourceDetail: 't' } } : {}),
  });
  const pivot = () => slotted(['Hurricane', ['Heat Wave', 'Hidden Power Ice'], 'Knock Off', 'U-turn'], 'Assault Vest');
  const values = (picked: PokemonSetAssumption | null) => picked?.moves.map(move => move.value);

  test('a revealed option fills its slot: the fixed Knock Off stays, Heat Wave goes (T89)', () => {
    const picked = selectCuratedSet([pivot()], evidence({ revealedMoves: ['uturn', 'hiddenpowerice', 'hurricane'] }));
    expect(values(picked)).toEqual(['Hurricane', 'Knock Off', 'U-turn']);
  });

  test('a revealed second option counts toward the fit like a first option (T89)', () => {
    const scarf = slotted(['Hurricane', 'U-turn', 'Taunt', 'Superpower'], 'Choice Scarf');
    const picked = selectCuratedSet([scarf, pivot()], evidence({ revealedMoves: ['uturn', 'hiddenpowerice', 'hurricane'] }));
    expect(picked?.item?.value).toBe('Assault Vest');
  });

  test('a revealed typeless Hidden Power fills a typed Hidden Power option (T89)', () => {
    // Logs before gen 8 show "Hidden Power" without its type.
    const picked = selectCuratedSet([pivot()], evidence({ revealedMoves: ['hiddenpower'] }));
    expect(values(picked)).toEqual(['Hurricane', 'Knock Off', 'U-turn']);
  });

  test('fixed moves come before the open slots, first options before the others (T89)', () => {
    const picked = selectCuratedSet([pivot()], evidence({ revealedMoves: ['hurricane'] }));
    expect(values(picked)).toEqual(['Hurricane', 'Knock Off', 'U-turn', 'Heat Wave', 'Hidden Power Ice']);
  });

  test('a set without slot options comes back as published (T89)', () => {
    const boots = utility();
    expect(selectCuratedSet([boots], evidence({ revealedMoves: ['roost'] }))).toBe(boots);
  });

  test('a revealed item counts toward the fit', () => {
    const boots = utility();
    // Hurricane matches both sets; the revealed Boots break the tie by fit.
    expect(selectCuratedSet([specs(), boots], evidence({
      revealedMoves: ['hurricane'], revealedItem: 'heavydutyboots',
    }))).toBe(boots);
  });
});
