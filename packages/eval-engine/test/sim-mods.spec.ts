import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import {
  JUMP_LIMIT,
  RELATIONS,
  TOLERANCE,
  idleActiveBodies,
  pickByStride,
  readManifest,
  realEvaluator,
  rootSubject,
  swapSides,
  sweepLeaves,
  reviveBattle,
  type Evaluator,
  type RelationGroup,
  type RelationName,
  type RelationSubject,
  type Violation,
} from './relation-checks';
import type { BranchRuntime } from '../src/branch-engine';
import type { DiceReport, ForcedDie } from '../src/dice/types';
import {
  accuracy,
  branchOf,
  clickWith,
  mon,
  runTurn,
  seedOfBranch,
  switchTo,
  turnLines,
  type Commands,
  type SlotChoices,
} from './branch-dice-support';
import { PRNG, type PokemonSet, Battle, Teams } from '@pkmn/sim';
import {
  rulesDex,
  toId,
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  logRules,
  speciesBaseId,
  type GameRules,
} from '@fulllifegames/replay-core';
import { playTurn as playTurnFromDiceKeepDice, reconstruct } from './arrival-turn';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Relation checks on search-made leaves. The static is fitted on real positions, and the search builds boards the fit never saw
 * (a +4 Cobalion at 5 % HP priced above a healthy body, gen9draft-2058494320). Five statements must hold on any board, so they run
 * on the 34 roots of the fixture manifest and on the leaves of a one-ply sweep (three choices per side by stride, every pair
 * advanced under the seed 1,2,3,4):
 *   own HP down never raises the score; foe HP down never lowers it (p1's view, steps of 10 points from 90 to 10 %);
 *   a stage on a fainted body adds nothing; a stage on an active body that every foe in front KOs before it acts adds
 *   nothing (5 % HP, +4 attack and special attack, the simulator decides who moves first and who KOs);
 *   swapped sides negate.
 * Each group (singles, doubles OU, VGC, Champions) reads its own positions. The detectors are proved by planted
 * faults in an evaluator, on a constant stub and on the real one.
 *
 * Known breaks: every break above 1e-3 goes, a smaller slope stays with its reason. The size of a break is the largest wrong-way
 * change of the score at ONE HP point: a break found on the grid of 10 % steps is scanned point by point (`jump` of the
 * violation). A pending break is above 1e-3 and waits for its cause; it is checked by a `test.fails`: the day it passes, that test
 * turns red and the entry goes. Every other position of the group passes at 1e-9 as a plain test, so the list never hides an
 * unnamed fault. The list is empty; a pending break goes back into `KNOWN_BREAKS` with its reason.
 */

interface KnownBreak {
  relation: 'ownHpDown' | 'foeHpDown';
  group: RelationGroup;
  position: string;
  reason: string;
}

/** An entry is `{ relation, group, position, reason }`; its `test.fails` row turns red the day the position passes. */
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
  const hpShare = (battle: Battle, side: 0 | 1): number => {
    const bodies = battle.sides[side].pokemon;
    return bodies.reduce((sum, mon) => sum + mon.hp, 0) / bodies.reduce((sum, mon) => sum + mon.maxhp, 0);
  };

  const constant: Evaluator = () => 0;
  const bases: [string, Evaluator][] = [['a constant stub', constant], ['the real evaluator', realEvaluator]];

  const plants: Record<RelationName, (base: Evaluator) => Evaluator> = {
    // Own damage pays: p1 gains 4 points (more than the real slope of any body) for every share of its own HP it has lost.
    ownHpDown: base => (battle, ruleset) => base(battle, ruleset) + 4 * (1 - hpShare(battle, 0)),
    foeHpDown: base => (battle, ruleset) => base(battle, ruleset) - 4 * (1 - hpShare(battle, 1)),
    idleStage: base => (battle, ruleset) => base(battle, ruleset) + 0.05 * battle.sides[0].pokemon
      .filter(mon => mon.hp <= 0)
      .reduce((sum, mon) => sum + mon.boosts.atk + mon.boosts.spa + mon.boosts.spe, 0),
    // Stages on an active body count in full: p1's actives gain 0.05 per stage of attack and special attack, p2's lose it.
    idleStageActive: base => (battle, ruleset) => base(battle, ruleset) + 0.05 * [0, 1].reduce((sum, side) => (side === 0 ? 1 : -1) * battle.sides[side].active
      .reduce((stages, mon) => stages + (mon ? mon.boosts.atk + mon.boosts.spa : 0), 0) + sum, 0),
    // An additive bias for p1: the swapped board gets the same bias and the two scores do not cancel.
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

await loadSimMods('gen9championsou');

type Mode = 'singles' | 'doubles';
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12'];

interface Scene {
  name: string;
  /** The side whose body leaves: it gets the switch request. */
  leaves: 'p1' | 'p2';
  /** Pikachu's move in p1a: a pivot's own, or the hit that sets the holder off. */
  trigger: string;
  /** The body in p2a that holds the item or ability, and its share of HP at the start of the turn. */
  holder?: { set: PokemonSet; hp: number };
}

const SCENES: Scene[] = [
  ...['uturn', 'voltswitch', 'flipturn', 'partingshot'].map(move => ({ name: move, leaves: 'p1' as const, trigger: move })),
  { name: 'Eject Button', leaves: 'p2', trigger: 'tackle', holder: { set: mon('Snorlax', ['tackle'], { item: 'Eject Button' }), hp: 1 } },
  { name: 'Eject Pack', leaves: 'p2', trigger: 'growl', holder: { set: mon('Snorlax', ['tackle'], { item: 'Eject Pack' }), hp: 1 } },
  { name: 'Emergency Exit', leaves: 'p2', trigger: 'tackle', holder: { set: mon('Golisopod', ['tackle'], { ability: 'Emergency Exit' }), hp: 0.55 } },
  { name: 'Wimp Out', leaves: 'p2', trigger: 'tackle', holder: { set: mon('Wimpod', ['tackle'], { ability: 'Wimp Out' }), hp: 0.6 } },
];

/** The two calls of a turn: both sides' clicks, then the replacement. The die rides on the action that runs after the pause. */
function plan(scene: Scene, mode: Mode, happens: boolean) {
  const doubles = mode === 'doubles';
  const pivots = scene.leaves === 'p1';
  const lead1 = mon('Pikachu', [scene.trigger]);
  const p1 = doubles ? [lead1, mon('Eevee', ['splash']), mon('Blissey', ['splash'])] : [lead1, mon('Blissey', ['splash'])];
  const lead2 = scene.holder?.set ?? mon('Snorlax', ['poisonpowder']);
  const partner2 = mon('Snorlax', [pivots ? 'splash' : 'poisonpowder']);
  const p2 = doubles ? [lead2, partner2, mon('Chansey', ['splash'])] : [lead2, mon('Chansey', ['splash'])];
  // Pivot: the foe's Poison Powder comes after the pause. Eject kinds in doubles: the second foe's Poison Powder does. Singles ejects:
  // nothing runs after the pause, so the die is the accuracy of the hit that sets the holder off (forced yes keeps the pause).
  const die: ForcedDie = !pivots && !doubles
    ? accuracy('p1a', scene.trigger, 'p2a', happens)
    : accuracy(pivots ? 'p2a' : 'p2b', 'poisonpowder', doubles ? 'p1b' : 'p1a', happens);
  const aim = scene.trigger === 'growl' ? '' : ' 1';
  const commands: Commands = doubles
    ? [{ side: 'p1', command: `move 1${aim}, move 1` }, { side: 'p2', command: pivots ? 'move 1 2, move 1' : 'move 1 1, move 1 2' }]
    : [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }];
  const own = (index: number, side: 'p1' | 'p2') => (die.name.slot === `${side}${'ab'[index]}` ? [die] : []);
  const choices: SlotChoices = doubles
    ? {
      p1: [clickWith(scene.trigger, own(0, 'p1')), clickWith('splash', own(1, 'p1'))],
      p2: [clickWith(pivots ? 'poisonpowder' : 'tackle', own(0, 'p2')), clickWith(pivots ? 'splash' : 'poisonpowder', own(1, 'p2'))],
    }
    : { p1: [clickWith(scene.trigger, own(0, 'p1'))], p2: [clickWith('poisonpowder', own(0, 'p2'))] };
  const bench = pivots ? 'blissey' : 'chansey';
  const replacement = doubles
    ? { command: 'switch 3, pass', slots: [switchTo(bench), null] }
    : { command: 'switch 2', slots: [switchTo(pivots ? 'blissey' : 'chansey')] };
  return { format: doubles ? 'gen9doublescustomgame' : 'gen9customgame', p1, p2, commands, choices, replacement, die };
}

/** Both calls of the turn. `happens` null plays the turn without a dice argument in either call. */
async function playTurn(scene: Scene, mode: Mode, seed: string, happens: boolean | null) {
  const setup = plan(scene, mode, happens ?? true);
  const runtime: BranchRuntime = await branchOf(setup.format, setup.p1, setup.p2, seed);
  const battle = runtime.battleStream.battle!;
  if (scene.holder) {
    const body = battle.sides[1].active[0]!;
    body.hp = Math.max(1, Math.floor(body.maxhp * scene.holder.hp));
  }
  const start = battle.log.length;
  const first = await runTurn(runtime, setup.commands, happens === null ? null : setup.choices);
  const paused = battle.sides[scene.leaves === 'p1' ? 0 : 1].requestState === 'switch' && battle.turn === 1;
  const slots = scene.leaves === 'p1' ? { p1: setup.replacement.slots, p2: [] } : { p1: [], p2: setup.replacement.slots };
  const second = await runTurn(runtime, [{ side: scene.leaves, command: setup.replacement.command }], happens === null ? null : slots);
  return { runtime, first, second, paused, lines: turnLines(runtime, start), seed: seedOfBranch(runtime), die: setup.die };
}

const missed = (lines: string[], slot: string) => lines.some(line => line.startsWith(`|-miss|${slot}`));
const tookOf = (result: { ok: boolean; dice?: DiceReport }) => result.dice?.forced.map(entry => entry.took);

describe.each(['singles', 'doubles'] as const)('a turn that pauses for a switch keeps its dice, %s', mode => {
  test.each(SCENES)('$name: the die applies on both answers, the report joins the calls and the stream ends where the natural turn ends', { timeout: 120000 }, async scene => {
    let paused = 0;
    for (const seed of SEEDS) {
      const twin = await playTurn(scene, mode, seed, null);
      expect(twin.paused, `${seed} the turn without a die pauses`).toBe(true);
      for (const happens of [true, false]) {
        const label = `${seed} ${happens}`;
        const forced = await playTurn(scene, mode, seed, happens);
        expect(forced.first.ok, label).toBe(true);
        expect(forced.second.ok, label).toBe(true);
        expect(forced.runtime.battleStream.battle!.turn, label).toBe(2);
        const laterAction = forced.die.name.moveId === 'poisonpowder';
        if (laterAction) {
          expect(forced.paused, label).toBe(true);
          paused += 1;
          expect(missed(forced.lines, forced.die.name.slot), label).toBe(!happens);
          expect(tookOf(forced.second), label).toEqual(['applied']);
          expect(forced.seed, label).toBe(twin.seed);
        } else if (happens) {
          // a forced yes on the 100 percent hit that sets the holder off changes nothing
          expect(forced.paused, label).toBe(true);
          expect(tookOf(forced.second), label).toEqual(['applied']);
          expect(forced.seed, label).toBe(twin.seed);
        }
      }
    }
    expect(paused + (mode === 'singles' && scene.leaves === 'p2' ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe('dice-keep-dice', () => {
  const playTurn = playTurnFromDiceKeepDice;


  /** Turns whose arrival plays the log perfectly (`isPerfectAlignment`): the unforced turn is the log's turn, so it is the baseline. */
  interface Scene { label: string; fixture: string; turn: number }
  const SCENES: Scene[] = [
    { label: 'singles (GPL DzBQ5azlO5l t13)', fixture: 'gpl-replay', turn: 13 },
    { label: 'doubles (gen9doublesou-2694811367 t4)', fixture: 'gen9doublesou-2694811367', turn: 4 },
    { label: 'VGC (gen9vgc2026regi-2630181744 t4)', fixture: 'gen9vgc2026regi-2630181744', turn: 4 },
  ];

  const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24'];
  const parts = (line: string) => line.split('|');
  const identSlot = (ident: string | undefined) => /^(p[12][a-d])/.exec(ident ?? '')?.[1] ?? '';
  const queuedMove = (line: string) => parts(line)[1] === 'move' && !line.includes('|[from]');

  /** The lines of each queued action, cut at the next action and at the first blank line (residuals and request breaks stay out). */
  function actionBlocks(lines: string[]): Map<string, string[]> {
    const blocks = new Map<string, string[]>();
    let key: string | null = null;
    for (const line of lines.filter(entry => !entry.startsWith('|t:|') && !entry.startsWith('|split|'))) {
      if (queuedMove(line)) {
        key = `${identSlot(parts(line)[2])}:${toId(parts(line)[3])}`;
        blocks.set(key, [line]);
      } else if (line === '|' || line.startsWith('|upkeep') || line.startsWith('|turn|')) {
        key = null;
      } else if (key) {
        blocks.get(key)!.push(line);
      }
    }
    return blocks;
  }

  function aimsOf(line: string): string[] {
    const spread = parts(line).find(part => part.startsWith('[spread]'))?.slice('[spread]'.length).trim().split(',').filter(Boolean) ?? [];
    return [...new Set([identSlot(parts(line)[4]), ...spread].filter(Boolean))];
  }

  /**
   * The die to force: the crit (or the accuracy) of the first damaging action whose target no later action aims at, flipped to the
   * answer the unforced turn did not give. A forced crit leaves the number of draws as it was; a forced miss on a hit removes the
   * crit and the damage roll, a forced hit on a miss adds them, so only the accuracy moves every later draw of a plain stream.
   */
  function flippedDie(lines: string[], kind: 'crit' | 'accuracy'): { die: ForcedDie; moveId: string } | null {
    const moves = lines.filter(queuedMove);
    for (const [index, line] of moves.entries()) {
      const [target] = aimsOf(line);
      const slot = identSlot(parts(line)[2]);
      // an action after this one on the same target would show the changed hit points in its own damage line
      if (!target || moves.slice(index + 1).some(later => aimsOf(later).includes(target))) continue;
      const dexMove = rulesDex(9).moves.get(toId(parts(line)[3]));
      // a move of fixed damage, of a set power or that always crits draws no crit; a move that cannot miss draws no accuracy
      if (dexMove.basePower === 0 || dexMove.damage || dexMove.ohko || dexMove.damageCallback) continue;
      if (kind === 'crit' && dexMove.willCrit) continue;
      if (kind === 'accuracy' && (dexMove.accuracy === true || dexMove.accuracy >= 100)) continue;
      const key = `${slot}:${toId(parts(line)[3])}`;
      const block = actionBlocks(lines).get(key) ?? [];
      const hit = block.some(entry => entry.startsWith(`|-damage|${target}`));
      const missed = block.some(entry => entry.startsWith('|-miss|')) || line.includes('[miss]');
      if (!hit && !missed) continue;
      const moveId = toId(parts(line)[3]);
      const happens = kind === 'crit' ? !block.some(entry => entry.startsWith('|-crit|')) : missed;
      return { moveId, die: { name: { slot, moveId, targetSlot: target, kind }, result: { happens } } };
    }
    return null;
  }

  const choicesWith = (flip: { die: ForcedDie; moveId: string }): SlotChoices => {
    const side = flip.die.name.slot.startsWith('p1') ? 'p1' : 'p2';
    const index = 'abcd'.indexOf(flip.die.name.slot[2]);
    const mine = Array.from({ length: index + 1 }, (_, at) => (at === index ? clickWith(flip.moveId, [flip.die]) : null));
    return side === 'p1' ? { p1: mine, p2: [] } : { p1: [], p2: mine };
  };

  function expectOthersKept(unforced: string[], forced: string[], key: string, label: string): number {
    const before = actionBlocks(unforced);
    const after = actionBlocks(forced);
    let compared = 0;
    for (const [other, lines] of before) {
      if (other === key || !after.has(other)) continue;
      expect(after.get(other), `${label}: ${other}`).toEqual(lines);
      compared += 1;
    }
    return compared;
  }

  const missIn = (lines: string[], key: string): boolean => (actionBlocks(lines).get(key) ?? []).some(line => line.startsWith('|-miss|')) || (actionBlocks(lines).get(key) ?? [])[0]?.includes('[miss]') === true;
  const critIn = (lines: string[], key: string): boolean => (actionBlocks(lines).get(key) ?? []).some(line => line.startsWith('|-crit|'));

  describe.each(SCENES)('an action left alone keeps its dice, $label', scene => {
    test('the first turn: the log\'s dice of every other action stay', { timeout: 300000 }, async () => {
      const plain = await reconstruct(scene.fixture, scene.turn);
      const unforced = await playTurn(plain.runtime, plain.replay.log, scene.turn);
      const flip = flippedDie(unforced.lines, 'crit');
      expect(flip, 'a damaging action to flip').not.toBeNull();
      const asked = await reconstruct(scene.fixture, scene.turn);
      const forced = await playTurn(asked.runtime, asked.replay.log, scene.turn, undefined, choicesWith(flip!));
      expect(forced.report?.forced.map(entry => entry.took)).toEqual(['applied']);
      const key = `${flip!.die.name.slot}:${flip!.moveId}`;
      expect(critIn(forced.lines, key)).toBe(flip!.die.result.happens);
      expect(expectOthersKept(unforced.lines, forced.lines, key, 'first turn')).toBeGreaterThan(0);
    });
  });

  interface Board { label: string; format: string; p1: PokemonSet[]; p2: PokemonSet[]; commands: Commands }
  const bench = (names: string[]) => names.map(species => mon(species, ['splash']));
  const BOARDS: Board[] = [
    {
      label: 'singles', format: 'gen9customgame',
      p1: [mon('Blissey', ['smog']), mon('Chansey', ['splash'])], p2: [mon('Snorlax', ['smog'])],
      commands: [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }],
    },
    {
      label: 'doubles', format: 'gen9doublescustomgame',
      p1: [mon('Blissey', ['smog']), mon('Chansey', ['smog'])], p2: [mon('Snorlax', ['smog']), mon('Snorlax', ['smog'])],
      commands: [{ side: 'p1', command: 'move 1 1, move 1 2' }, { side: 'p2', command: 'move 1 1, move 1 2' }],
    },
    {
      label: 'VGC (a team of six)', format: 'gen9doublescustomgame',
      p1: [mon('Blissey', ['smog']), mon('Chansey', ['smog']), ...bench(['Eevee', 'Pikachu', 'Snorlax', 'Vaporeon'])],
      p2: [mon('Snorlax', ['smog']), mon('Snorlax', ['smog']), ...bench(['Eevee', 'Pikachu', 'Blissey', 'Vaporeon'])],
      commands: [{ side: 'p1', command: 'move 1 1, move 1 2' }, { side: 'p2', command: 'move 1 1, move 1 2' }],
    },
  ];

  describe.each(BOARDS)('an action left alone keeps its dice on a later turn, $label', board => {
    // a later turn draws from the plain stream: any seed is a natural turn, and the check needs one where more than one action runs
    const play = async (seed: string, flip: { die: ForcedDie; moveId: string } | null) => {
      const runtime = await branchOf(board.format, board.p1, board.p2, '1,2,3,4');
      const first = await runTurn(runtime, board.commands, null);
      expect(first.ok, 'the first turn').toBe(true);
      const battle = runtime.battleStream.battle!;
      expect(battle.turn).toBe(2);
      battle.prng = new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
      const start = battle.log.length;
      const result = await runTurn(runtime, board.commands, flip ? choicesWith(flip) : null);
      return { result, lines: turnLines(runtime, start) };
    };

    test('the natural dice of every other action stay', { timeout: 120000 }, async () => {
      let checked = 0;
      for (const seed of SEEDS) {
        const unforced = await play(seed, null);
        expect(unforced.result.ok, seed).toBe(true);
        const flip = flippedDie(unforced.lines, 'accuracy');
        expect(flip, seed).not.toBeNull();
        const forced = await play(seed, flip);
        expect(forced.result.ok, seed).toBe(true);
        expect(forced.result.ok ? forced.result.dice?.forced.map(entry => entry.took) : null, seed).toEqual(['applied']);
        const key = `${flip!.die.name.slot}:${flip!.moveId}`;
        expect(missIn(forced.lines, key), seed).toBe(!flip!.die.result.happens);
        checked += expectOthersKept(unforced.lines, forced.lines, key, `${board.label}, seed ${seed}`);
      }
      expect(checked).toBeGreaterThanOrEqual(SEEDS.length);
    });
  });
});

const root = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = [
  'packages/eval-engine/test/fixtures',
  'packages/eval-engine/test/fixtures/champions',
  'packages/replay-core/test/fixtures',
];

interface Replay { id: string; format: string; formatid?: string; players: string[]; log: string }

function replays(): Array<{ tag: string; replay: Replay }> {
  const found: Array<{ tag: string; replay: Replay }> = [];
  const seen = new Set<string>();
  for (const dir of FIXTURES) {
    if (!existsSync(`${root}${dir}`)) continue;
    for (const name of readdirSync(`${root}${dir}`)) {
      if (!name.endsWith('.json') || seen.has(name)) continue;
      const parsed = JSON.parse(readFileSync(`${root}${dir}/${name}`, 'utf8')) as Partial<Replay>;
      if (typeof parsed.log !== 'string' || !parsed.format) continue;
      seen.add(name);
      found.push({ tag: name.replace(/\.json$/, ''), replay: { id: name, players: [], ...parsed } as Replay });
    }
  }
  return found;
}

const STATIC_FLAG = /^(L\d+|M|F|shiny)$/;
const ENTRY = /^\|(switch|drag|replace)\|(p[12])[a-d]?: ([^|]*)\|([^|]*)/;

/** Species base id and the static flags of a details string, flags in the protocol's order. */
function reading(details: string, rules: GameRules): { base: string; flags: string } {
  const [species, ...flags] = details.split(', ');
  return { base: speciesBaseId(species.trim().replace(/-\*$/, ''), rules), flags: flags.filter(flag => STATIC_FLAG.test(flag)).join(', ') };
}

function shownBodies(log: string): Array<{ side: 'p1' | 'p2'; name: string; base: string; flags: string; line: string }> {
  const bodies = new Map<string, { side: 'p1' | 'p2'; name: string; base: string; flags: string; line: string }>();
  const rules = logRules(log);
  for (const raw of log.split('\n')) {
    const entry = ENTRY.exec(raw.replace(/\r$/, ''));
    if (!entry) continue;
    const { base, flags } = reading(entry[4], rules);
    const key = [entry[2], entry[3], base, flags].join('|');
    if (!bodies.has(key)) bodies.set(key, { side: entry[2] as 'p1' | 'p2', name: entry[3], base, flags, line: raw });
  }
  return [...bodies.values()];
}

const SWEEP = replays();

describe('the built sets switch in with the lines the replay has', () => {
  test('the sweep covers the fixture replays of both game types, VGC and Champions', () => {
    expect(SWEEP.length).toBeGreaterThanOrEqual(22);
    const formats = SWEEP.map(entry => entry.replay.format);
    expect(formats.some(format => /Doubles/.test(format))).toBe(true);
    expect(formats.some(format => /VGC/.test(format) && !/Champions/.test(format))).toBe(true);
    expect(formats.some(format => /Champions/.test(format))).toBe(true);
    expect(formats.some(format => /\] OU$/.test(format))).toBe(true);
  });

  test.each(SWEEP.map(entry => [entry.tag, entry.replay] as const))('%s: every body of the replay exists in the branch battle as the replay shows it', async (_tag, replay) => {
    const format = getBranchSimulatorFormat(replay as never);
    await loadSimMods(format);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const battle = new Battle({
      formatid: format as never, seed: [1, 2, 3, 4],
      p1: { name: 'p1', team: Teams.pack(p1Team) }, p2: { name: 'p2', team: Teams.pack(p2Team) },
    });
    const missing = shownBodies(replay.log).filter(shown => {
      const side = battle.sides[shown.side === 'p1' ? 0 : 1];
      return !side.pokemon.some(body => {
        const mine = reading(body.details, logRules(replay.log));
        return body.name === shown.name && mine.base === shown.base && mine.flags === shown.flags;
      });
    }).map(shown => `${shown.side} ${shown.line.split('|').slice(2, 4).join(' | ')}`);
    expect(missing).toEqual([]);
  }, 60_000);
});
