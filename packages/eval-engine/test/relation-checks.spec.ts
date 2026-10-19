import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import {
  RELATIONS, TOLERANCE, pickByStride, readManifest, realEvaluator, rootSubject, swapSides, sweepLeaves, reviveBattle,
  type Evaluator, type RelationGroup, type RelationName, type RelationSubject, type Violation,
} from './relation-checks';

/**
 * Round 72 (T240): relation checks on search-made leaves. The static is fitted on real positions, and the search
 * builds boards the fit never saw (a +4 Cobalion at 5 % HP priced above a healthy body, gen9draft-2058494320). Four
 * statements must hold on any board, so they run on the 34 roots of the fixture manifest and on the leaves of a
 * one-ply sweep (three choices per side by stride, every pair advanced under the seed 1,2,3,4):
 *   own HP down never raises the score; foe HP down never lowers it (p1's view, steps of 10 points from 90 to 10 %);
 *   a stage on a fainted body adds nothing; swapped sides negate.
 * Each group (singles, doubles OU, VGC, Champions) reads its own positions. The detectors are proved by planted
 * faults in an evaluator, on a constant stub and on the real one.
 *
 * Known breaks. A break the group has today is named below by relation, group and position (the fixture file) with
 * its TODO, and it is checked by a `test.fails`: the day the TODO makes the position pass, that test turns red and
 * the entry goes. Every other position of the group must pass as a plain test, so the marker never hides an unnamed
 * fault. The causes, read at one HP point (out/break-diag.json of lane C): the 1v1 race of boostsBiting flips at one
 * HP (up to 0.15 in singles, 0.06 in VGC, 0.01 in Champions) and the matchup term falls faster than the bodies term
 * rises over a range of HP (up to 1e-3).
 */

/** T199 is booked (pairFocus as a ramp; its second source is boostsBiting in VGC). */
const T199 = 'T199';
/** Lane C's proposal for the breaks outside T199: to be booked by the integrator, with this number or another one. */
const HP_MONOTONY = 'T248';

interface KnownBreak {
  relation: 'ownHpDown' | 'foeHpDown';
  group: RelationGroup;
  position: string;
  todo: string;
}

const known = (todo: string, relation: KnownBreak['relation'], group: RelationGroup, ...positions: string[]): KnownBreak[] =>
  positions.map(position => ({ relation, group, position, todo }));

const KNOWN_BREAKS: KnownBreak[] = [
  ...known(T199, 'foeHpDown', 'vgc',
    'gen9vgc2026regi-2629703929-t13', 'gen9vgc2026regi-2629703929-t8', 'gen9vgc2026regi-2629731825-t2',
    'gen9vgc2026regi-2629760324-t6', 'gen9vgc2026regi-2630461565-t2'),
  ...known(HP_MONOTONY, 'ownHpDown', 'vgc',
    'gen9vgc2026regi-2629703929-t13', 'gen9vgc2026regi-2630685175-t4', 'gen9vgc2026regi-2630685175-t7',
    'gen9vgc2026regi-2630685175-t7-played', 'gen9vgc2026regi-2630685175-t8'),
  ...known(HP_MONOTONY, 'ownHpDown', 'singles', 'smogtours-gen8ou-573756-t73', 'gen9ou-2658663776-t2'),
  ...known(HP_MONOTONY, 'foeHpDown', 'singles', 'gen9ou-2658675932-t2', 'smogtours-gen9ou-749351-t10', 'smogtours-gen9ou-751466-t2'),
  ...known(HP_MONOTONY, 'ownHpDown', 'champions', 'gen9championsvgc2026regmbbo3-2634199230-t5'),
  ...known(HP_MONOTONY, 'foeHpDown', 'champions', 'gen9championsvgc2026regmbbo3-2634199230-t5'),
];

await loadSimMods('gen9championscustomgame');

const roots = readManifest().map(rootSubject);
const sweeps = roots.map(root => sweepLeaves(root));
const leaves = sweeps.flatMap(sweep => sweep.leaves);
const subjects = [...roots, ...leaves];

const GROUPS: { group: RelationGroup; name: string }[] = [
  { group: 'singles', name: 'singles' },
  { group: 'doublesou', name: 'doubles OU' },
  { group: 'vgc', name: 'VGC' },
  { group: 'champions', name: 'Champions' },
];

/** What each relation says, for the test titles. */
const STATEMENT: Record<RelationName, string> = {
  ownHpDown: 'own HP down never raises the score',
  foeHpDown: 'foe HP down never lowers the score',
  idleStage: 'a stage on a fainted body adds nothing',
  swapNegates: 'swapped sides negate the score',
};

const scene = (violations: Violation[]): string[] =>
  violations.slice(0, 5).map(violation => `${violation.subject}: ${violation.detail}`);

const violationsOf = (name: RelationName, list: RelationSubject[], evaluate: Evaluator): Violation[] =>
  list.flatMap(subject => RELATIONS[name](subject, evaluate));

describe('relation checks: the sweep', () => {
  test('pickByStride takes the first, the middle and the last, or all when three or fewer', () => {
    expect(pickByStride([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 4, 7]);
    expect(pickByStride([1, 2, 3, 4])).toEqual([1, 3, 4]);
    expect(pickByStride(['a', 'b'])).toEqual(['a', 'b']);
    expect(pickByStride([])).toEqual([]);
  });

  test('34 roots and at least 200 leaves, each group with its share, every score finite and inside [-1, 1]', () => {
    expect(roots).toHaveLength(34);
    expect(leaves.length).toBeGreaterThanOrEqual(200);
    const floors: Record<RelationGroup, number> = { singles: 70, doublesou: 55, vgc: 85, champions: 20 };
    for (const { group } of GROUPS) {
      expect(leaves.filter(leaf => leaf.group === group).length, `leaves of ${group}`).toBeGreaterThanOrEqual(floors[group]);
    }
    for (const subject of subjects) {
      const score = realEvaluator(reviveBattle(subject.serialized, subject.ruleset), subject.ruleset);
      expect(Number.isFinite(score) && Math.abs(score) <= 1, subject.label).toBe(true);
    }
  });

  test('the sweep is deterministic: a second sweep of one position gives the same leaves', () => {
    const again = sweepLeaves(roots[0]);
    expect(again.leaves.map(leaf => [leaf.label, leaf.serialized])).toEqual(sweeps[0].leaves.map(leaf => [leaf.label, leaf.serialized]));
  });

  test('swapSides exchanges the two sides and swapping twice restores the board', () => {
    for (const root of roots) {
      const original = reviveBattle(root.serialized, root.ruleset);
      const names = original.sides.map(side => side.pokemon.map(mon => mon.species.name));
      const swapped = swapSides(reviveBattle(root.serialized, root.ruleset));
      expect(swapped.sides.map(side => side.pokemon.map(mon => mon.species.name)), root.label).toEqual([names[1], names[0]]);
      expect(swapped.sides.map(side => side.id)).toEqual(['p1', 'p2']);
      expect(swapped.sides.map(side => side.n)).toEqual([0, 1]);
      const twice = swapSides(swapped);
      const score = (battle: Battle) => realEvaluator(battle, root.ruleset);
      expect(Math.abs(score(twice) - score(original)), root.label).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

for (const { group, name } of GROUPS) {
  describe(`relation checks: ${name}`, () => {
    const mine = subjects.filter(subject => subject.group === group);

    for (const relation of ['ownHpDown', 'foeHpDown'] as const) {
      const knownHere = KNOWN_BREAKS.filter(entry => entry.group === group && entry.relation === relation);
      const named = new Set(knownHere.map(entry => entry.position));

      test(`${name}: ${STATEMENT[relation]}, outside the positions a TODO names`, () => {
        const rest = mine.filter(subject => !named.has(subject.position));
        expect(scene(violationsOf(relation, rest, realEvaluator))).toEqual([]);
      });

      for (const entry of knownHere) {
        // Expected failure: red today, so the day the TODO makes this position pass, this test fails and the entry goes.
        test.fails(`${entry.todo} ${name}: ${STATEMENT[relation]} (${entry.position})`, () => {
          const board = mine.filter(subject => subject.position === entry.position);
          expect(scene(violationsOf(relation, board, realEvaluator))).toEqual([]);
        });
      }
    }

    test(`${name}: ${STATEMENT.idleStage}`, () => {
      expect(scene(violationsOf('idleStage', mine, realEvaluator))).toEqual([]);
    });

    test(`${name}: ${STATEMENT.swapNegates}`, () => {
      expect(scene(violationsOf('swapNegates', mine, realEvaluator))).toEqual([]);
    });
  });
}

describe('relation checks: planted faults', () => {
  /** Share of the standing HP a side keeps, 1 for a full side. */
  const hpShare = (battle: Battle, side: 0 | 1): number => {
    const bodies = battle.sides[side].pokemon;
    return bodies.reduce((sum, mon) => sum + mon.hp, 0) / bodies.reduce((sum, mon) => sum + mon.maxhp, 0);
  };

  const constant: Evaluator = () => 0;
  const bases: [string, Evaluator][] = [['a constant stub', constant], ['the real evaluator', realEvaluator]];

  const plants: Record<RelationName, (base: Evaluator) => Evaluator> = {
    // Own damage pays: p1 gains 4 points (more than the real slope of any body) for every share of its own HP it has lost.
    ownHpDown: base => (battle, ruleset) => base(battle, ruleset) + 4 * (1 - hpShare(battle, 0)),
    // Foe damage costs: p1 loses 4 points for every share of the foe's HP that is gone.
    foeHpDown: base => (battle, ruleset) => base(battle, ruleset) - 4 * (1 - hpShare(battle, 1)),
    // A fainted body of p1 still counts its stages.
    idleStage: base => (battle, ruleset) => base(battle, ruleset) + 0.05 * battle.sides[0].pokemon
      .filter(mon => mon.hp <= 0)
      .reduce((sum, mon) => sum + mon.boosts.atk + mon.boosts.spa + mon.boosts.spe, 0),
    // An additive bias for p1: the swapped board gets the same bias and the two scores no longer cancel.
    swapNegates: base => (battle, ruleset) => base(battle, ruleset) + 0.05,
  };

  // One singles and one doubles board with a fainted body on each side of the sweep, so every relation can see its fault.
  const withFainted = (gameType: 'singles' | 'doubles') =>
    roots.find(root => root.gameType === gameType && /\d+ fainted/.test(root.reason))!;
  const boards: [string, RelationSubject][] = [['singles', withFainted('singles')], ['doubles', withFainted('doubles')]];

  for (const [baseName, base] of bases) {
    for (const [gameType, board] of boards) {
      for (const relation of Object.keys(RELATIONS) as RelationName[]) {
        test(`${STATEMENT[relation]}: a planted fault is found on ${gameType} (${board.position}) with ${baseName}`, () => {
          const found = RELATIONS[relation](board, plants[relation](base));
          expect(found.length, `the fault went unseen on ${board.label}`).toBeGreaterThan(0);
          expect(found.every(violation => violation.relation === relation && violation.size > TOLERANCE)).toBe(true);
        });
      }
    }
  }

  test('a constant evaluator breaks no relation, so a violation found above is the planted fault and not the board', () => {
    for (const relation of Object.keys(RELATIONS) as RelationName[]) {
      expect(violationsOf(relation, roots, constant), relation).toEqual([]);
    }
  });
});
