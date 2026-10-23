import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import {
  JUMP_LIMIT, RELATIONS, TOLERANCE, idleActiveBodies, pickByStride, readManifest, realEvaluator, rootSubject, swapSides, sweepLeaves, reviveBattle,
  type Evaluator, type RelationGroup, type RelationName, type RelationSubject, type Violation,
} from './relation-checks';

/**
 * Round 72 (T240): relation checks on search-made leaves. The static is fitted on real positions, and the search
 * builds boards the fit never saw (a +4 Cobalion at 5 % HP priced above a healthy body, gen9draft-2058494320). Five
 * statements must hold on any board, so they run on the 34 roots of the fixture manifest and on the leaves of a
 * one-ply sweep (three choices per side by stride, every pair advanced under the seed 1,2,3,4):
 *   own HP down never raises the score; foe HP down never lowers it (p1's view, steps of 10 points from 90 to 10 %);
 *   a stage on a fainted body adds nothing; a stage on an active body that every foe in front KOs before it acts adds
 *   nothing (T249, round 73: 5 % HP, +4 attack and special attack, the simulator decides who moves first and who KOs);
 *   swapped sides negate.
 * Each group (singles, doubles OU, VGC, Champions) reads its own positions. The detectors are proved by planted
 * faults in an evaluator, on a constant stub and on the real one.
 *
 * Known breaks (T248, design gate 2a of round 73: every break above 1e-3 goes, a smaller slope stays with its reason). The
 * size of a break is the largest wrong-way change of the score at ONE HP point: a break found on the grid of 10 % steps
 * is scanned point by point (`jump` of the violation). A pending break is above 1e-3 and waits for its cause; it is
 * checked by a `test.fails`: the day it passes, that test turns red and the entry goes. Every other position of the
 * group passes at 1e-9 as a plain test, so the list never hides an unnamed fault. The race flips of boostsBiting that
 * stood here (nine positions) went with the fresh-race reading of `stageBites` (score/boost-race.ts); the slopes of the
 * matchup term (five positions, 1e-5 to 1.3e-3 per HP point) went with the pair value of the winner's HP share
 * (score/matchup.ts, `pairValue`); no smooth slope is left, so the list holds no slope entry. The one
 * pending break, the bench gate of a stage drop (Champions 2634199230 turn 5, Incineroar 81 to 80 of 174, 0.031 on the bar:
 * the holder starts to win its front race and the whole bench behind it starts to count), went in round 76 (T259) with the
 * ramp of `benchShare` (score/boost-race.ts): the gate is the rule of round 69 (boost-bite-drops.spec.ts) and stays, its
 * credit now grows over the margin of the two clocks. No break is left, so KNOWN_BREAKS is empty.
 */

interface KnownBreak {
  relation: 'ownHpDown' | 'foeHpDown';
  group: RelationGroup;
  position: string;
  /** The cause, for the title. */
  reason: string;
}

/** A pending break of a position: `...pending(reason, relation, group, position)` in KNOWN_BREAKS (none is left). */
export const pending = (reason: string, relation: KnownBreak['relation'], group: RelationGroup, ...positions: string[]): KnownBreak[] =>
  positions.map(position => ({ relation, group, position, reason }));

const KNOWN_BREAKS: KnownBreak[] = [];

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
  idleStageActive: 'a stage on an active body that every foe in front KOs first adds nothing',
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
      const waiting = new Set(knownHere.map(entry => entry.position));
      const above = (list: RelationSubject[]) => violationsOf(relation, list, realEvaluator).filter(violation => (violation.jump ?? violation.size) > JUMP_LIMIT);

      test(`${name}: ${STATEMENT[relation]}, outside the positions the list names`, () => {
        const rest = mine.filter(subject => !named.has(subject.position));
        expect(scene(violationsOf(relation, rest, realEvaluator))).toEqual([]);
      });

      test(`${name}: ${STATEMENT[relation]} by more than ${JUMP_LIMIT} at one HP point, outside the pending positions`, () => {
        expect(scene(above(mine.filter(subject => !waiting.has(subject.position))))).toEqual([]);
      });

      for (const entry of knownHere) {
        // Expected failure: red today, so the day the position passes, this test fails and the entry goes.
        test.fails(`${entry.reason} ${name}: ${STATEMENT[relation]} by more than ${JUMP_LIMIT} (${entry.position})`, () => {
          const board = mine.filter(subject => subject.position === entry.position);
          expect(scene(above(board))).toEqual([]);
        });
      }
    }

    test(`${name}: ${STATEMENT.idleStage}`, () => {
      expect(scene(violationsOf('idleStage', mine, realEvaluator))).toEqual([]);
    });

    test(`${name}: ${STATEMENT.idleStageActive}`, () => {
      expect(scene(violationsOf('idleStageActive', mine, realEvaluator))).toEqual([]);
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
    // Stages on an active body count in full: p1's actives gain 0.05 per stage of attack and special attack, p2's lose it.
    idleStageActive: base => (battle, ruleset) => base(battle, ruleset) + 0.05 * [0, 1].reduce((sum, side) => (side === 0 ? 1 : -1) * battle.sides[side].active
      .reduce((stages, mon) => stages + (mon ? mon.boosts.atk + mon.boosts.spa : 0), 0) + sum, 0),
    // An additive bias for p1: the swapped board gets the same bias and the two scores no longer cancel.
    swapNegates: base => (battle, ruleset) => base(battle, ruleset) + 0.05,
  };

  // One singles and one doubles board with a fainted body on each side of the sweep, so every relation can see its fault.
  const withFainted = (gameType: 'singles' | 'doubles') =>
    roots.find(root => root.gameType === gameType && /\d+ fainted/.test(root.reason))!;
  const boards: [string, RelationSubject][] = [['singles', withFainted('singles')], ['doubles', withFainted('doubles')]];
  // The fault of the stage relation needs an active body that every foe in front KOs first: the first position of the game type that has one.
  const withIdle = (gameType: 'singles' | 'doubles') => subjects.find(subject => subject.gameType === gameType && subject.kind === 'root' &&
    ([0, 1] as const).some(side => idleActiveBodies(reviveBattle(subject.serialized, subject.ruleset), side).length > 0))!;
  const idleBoards: [string, RelationSubject][] = [['singles', withIdle('singles')], ['doubles', withIdle('doubles')]];

  for (const [baseName, base] of bases) {
    for (const [gameType, board] of boards) {
      for (const relation of Object.keys(RELATIONS) as RelationName[]) {
        const seen = relation === 'idleStageActive' ? idleBoards.find(([name]) => name === gameType)![1] : board;
        test(`${STATEMENT[relation]}: a planted fault is found on ${gameType} (${seen.position}) with ${baseName}`, () => {
          const found = RELATIONS[relation](seen, plants[relation](base));
          expect(found.length, `the fault went unseen on ${seen.label}`).toBeGreaterThan(0);
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
