import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 89 (T322, #59), block 2 stage 5: the sentence of the strand acquittal. A side whose grade the strand round softened says
 * so on the card: it names the move and the die behind the strand (read from the record's class key and the Dex of the game's rule
 * set, never from a list of ours) and its chance. Doubles keys name the move and the slots; singles keys name no actor, so the
 * move comes from the side's own choice and the opponent option of the column. A side whose grade nobody softened says nothing.
 */

const ranked = (choice: string, label: string, ev: number): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });

const names: [string, string] = ['Alice', 'Bob'];
const GEN9 = { p1: null, p2: null, gen: 9 };

/** Singles: p2 (Bob) plays one of three attacks where Recover was the better line; a record lowers the regret from 0.25 to 0.15. */
const singles: EvalResult = {
  score: 0.1, interval: 0.05, depthCompleted: 2,
  perSide: {
    p1: [ranked('move tackle', 'Tackle', 0.2), ranked('move uturn', 'U-turn', 0.05)],
    p2: [
      ranked('move recover', 'Recover', -0.05), ranked('move thunderbolt', 'Thunderbolt', -0.3),
      ranked('move tackle', 'Tackle', -0.3), ranked('move kowtowcleave', 'Kowtow Cleave', -0.3),
    ],
  },
};

/** Doubles: p2 played Protect + Drain Punch against the best Rock Slide + Drain Punch. */
const doubles: EvalResult = {
  score: 0, interval: 0, depthCompleted: 1,
  perSide: {
    p1: [ranked('move tackle 1, move protect', 'Tackle + Protect', 0.1)],
    p2: [
      ranked('move rockslide, move drainpunch 1', 'Rock Slide + Drain Punch', 0.05),
      ranked('move protect, move drainpunch 1', 'Protect + Drain Punch', -0.3),
    ],
  },
};

type Strand = NonNullable<EvalResult['strands']>['p2'];
const record = (over: Partial<NonNullable<Strand>> & Pick<NonNullable<Strand>, 'strands'>, best: string, played: string, regret = 0.15): Strand => ({
  played, best, playedEv: 0.05 - regret, bestEv: 0.05, regret, regretBefore: 0.25, ...over,
});

const singlesCard = (strands: Strand, actives: typeof GEN9 | null = GEN9, played = 'Thunderbolt') => {
  const analysis = analyzeTurn({
    turn: 7, result: { ...singles, strands: { p2: strands } },
    played: { p1: { kind: 'move', name: 'Tackle', tera: false }, p2: { kind: 'move', name: played, tera: false } },
    playedOutcome: 0, scoreBefore: 0.1, scoreAfter: -0.2, ...(actives ? { actives } : {}),
  });
  return { analysis, text: summarizeTurn(analysis, names) };
};

const doublesCard = (strands: Strand, actives: typeof GEN9 | null = GEN9) => {
  const analysis = analyzeTurn({
    turn: 5, result: { ...doubles, strands: { p2: strands } },
    played: {
      p1: null, p2: null,
      p1Slots: [{ kind: 'move', name: 'Tackle', targetLoc: 1 }, { kind: 'move', name: 'Protect', targetLoc: null }],
      p2Slots: [{ kind: 'move', name: 'Protect', targetLoc: null }, { kind: 'move', name: 'Drain Punch', targetLoc: 1 }],
    },
    playedOutcome: null, scoreBefore: 0, scoreAfter: null, ...(actives ? { actives } : {}),
  });
  return { analysis, text: summarizeTurn(analysis, names) };
};

describe('the sentence of a softened grade', () => {
  test('doubles, a die of the played row: the move comes from the class key, the effect from the Dex, the chance from the record', () => {
    const { analysis, text } = doublesCard(record({
      strands: [{ role: 'P', classKey: 'p2a:rockslide>p1a=hit-nokill+flinch', chance: 0.3, column: 'Tackle + Protect', before: -0.9, searched: -0.2 }],
    }, 'move rockslide, move drainpunch 1', 'move protect, move drainpunch 1'));
    expect(analysis.p2.tier).toBe('inaccuracy');
    expect(analysis.p2.strand).toMatchObject({ from: 'mistake', tier: 'inaccuracy', dice: [{ kind: 'effect', move: 'Rock Slide', effect: 'flinch' }] });
    expect(text).toContain("Bob's mistake softens to an inaccuracy: against Tackle + Protect, the engine first priced the 30% flinch from Rock Slide roughly; " +
      'searched in full, the played line holds up better there.');
  });

  test('doubles, a die of the better line: the sentence says the better line is worth less than it first read', () => {
    const { text } = doublesCard(record({
      strands: [{ role: 'B', classKey: 'p2a:rockslide>p1a=miss', chance: 0.1, column: 'Tackle + Protect', before: 0.5, searched: 0.2 }],
    }, 'move rockslide, move drainpunch 1', 'move protect, move drainpunch 1'));
    expect(text).toContain("Bob's mistake softens to an inaccuracy: against Tackle + Protect, Rock Slide + Drain Punch is worth less than it first read, " +
      'because the engine searched the 10% miss by Rock Slide in full.');
  });

  test('doubles, a class of two dice names both', () => {
    const { analysis, text } = doublesCard(record({
      strands: [{ role: 'P', classKey: 'p2a:rockslide>p1a=hit-nokill+flinch|p1a:tackle>p2a=miss', chance: 0.03, column: 'Tackle + Protect', before: -0.9, searched: -0.2 }],
    }, 'move rockslide, move drainpunch 1', 'move protect, move drainpunch 1'));
    expect(analysis.p2.strand?.dice).toEqual([{ kind: 'effect', move: 'Rock Slide', effect: 'flinch' }, { kind: 'miss', move: 'Tackle' }]);
    expect(text).toContain('the 3% case of flinch from Rock Slide and miss by Tackle');
  });

  test('singles, a secondary die: the key names no move, the own choice and the column decide who owns it', () => {
    const { analysis, text } = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-nokill+par', chance: 0.1, column: 'Tackle', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move thunderbolt'));
    expect(analysis.p2.tier).toBe('inaccuracy');
    expect(analysis.p2.strand?.dice).toEqual([{ kind: 'effect', move: 'Thunderbolt', effect: 'paralysis' }]);
    expect(text).toContain("Bob's mistake softens to an inaccuracy: against Tackle, the engine first priced the 10% paralysis from Thunderbolt roughly;");
  });

  test('singles, the die of the opponent option: a paralysis the own move cannot cause belongs to the column', () => {
    const { analysis } = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-nokill+par', chance: 0.1, column: 'Thunderbolt', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move tackle'), GEN9, 'Tackle');
    expect(analysis.p2.strand?.dice).toEqual([{ kind: 'effect', move: 'Thunderbolt', effect: 'paralysis' }]);
  });

  test('singles, a knockout against a status move belongs to the own damaging move; two damaging moves leave the move unnamed', () => {
    const own = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-kill', chance: 1 / 24, column: 'Defog', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move kowtowcleave'), GEN9, 'Kowtow Cleave');
    expect(own.analysis.p2.strand?.dice).toEqual([{ kind: 'kill', move: 'Kowtow Cleave' }]);
    expect(own.text).toContain('the 4% knockout by Kowtow Cleave');
    const unclear = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-kill', chance: 1 / 24, column: 'Quick Attack', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move tackle'), GEN9, 'Tackle');
    expect(unclear.analysis.p2.strand?.dice).toEqual([{ kind: 'kill' }]);
    expect(unclear.text).toContain('priced the 4% knockout roughly');
  });

  test('singles, two events: the first part is p1\'s, the second p2\'s', () => {
    const { analysis } = singlesCard(record({
      strands: [{ role: 'P', classKey: 'miss|hit-nokill+par', chance: 0.05, column: 'Tackle', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move thunderbolt'));
    expect(analysis.p2.strand?.dice).toEqual([{ kind: 'miss', move: 'Tackle' }, { kind: 'effect', move: 'Thunderbolt', effect: 'paralysis' }]);
  });

  test('a record that clears the tier says the verdict clears', () => {
    const { text } = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-nokill+par', chance: 0.1, column: 'Tackle', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move thunderbolt', 0.05));
    expect(text).toContain("Bob's mistake clears: against Tackle,");
  });

  test('without the board context the sentence names the chance and no move', () => {
    const { analysis, text } = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-nokill+par', chance: 0.1, column: 'Tackle', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move thunderbolt'), null);
    expect(analysis.p2.strand?.dice).toBeUndefined();
    expect(text).toContain("Bob's mistake softens to an inaccuracy: against Tackle, the engine first priced one outcome of 10% roughly; searched in full, the played line holds up better there.");
  });

  test('a grade nobody softened says nothing of a strand', () => {
    const { text } = singlesCard(record({
      strands: [{ role: 'P', classKey: 'hit-nokill+par', chance: 0.1, column: 'Tackle', before: -0.9, searched: -0.4 }],
    }, 'move recover', 'move thunderbolt', 0.3));
    expect(text).not.toMatch(/first priced|searched in full/);
  });
});
