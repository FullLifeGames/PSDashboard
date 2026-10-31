import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { genShape } from '../src/dice/recognize';
import { seedOf, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import {
  critsOf, damageAtRaw, dieOf, forcedOn, missesOf, monOf, SWEEP_CASES, sweepBoard, sweepClicks, sweepTargets, VGC_RULES,
} from './dice-sweep-support';

// Round 82 (forced dice), lane A2b: the damage roll sweep. Per rule set and game type, a physical, a special and a spread move
// (and the confusion self-hit from Gen 3 on) with every step of the roll forced, on every target on its own: the damage a
// step deals equals the damage the simulator deals when it draws the step's raw value itself, no step deals less than the
// one before, and the top step deals more than step 0. Gens 1 and 2 have 39 steps (higher raw hurts more), Gens 3 on 16
// (lower raw hurts more); the module's step always runs from the lowest damage up.
await loadSimMods('gen9championsou');

const SEEDS = Array.from({ length: 24 }, (_, index) => seedOf(index));
const SCENES = [
  { id: 'a physical move', move: 'strength', target: 'normal' },
  { id: 'a special move', move: 'thunderbolt', target: 'normal' },
  { id: 'a spread move', move: 'rockslide', target: 'allAdjacentFoes' },
];

/** Every step of the roll on one slot against the simulator's own draw of the step's raw value. */
function checkRoll(rules: Rules, mode: Mode, scene: { move: string; target: string }, slot: string, vgc: boolean): void {
  const { move, target } = scene;
  const shape = genShape(rules.generation).roll;
  // a seed whose turn hits every target without a crit: the roll is then the only die that moves the damage
  const clicks = sweepClicks(mode, target);
  const seed = SEEDS.find(candidate => {
    const plain = sweepBoard(rules, move, mode, candidate, vgc);
    const start = plain.log.length;
    plain.choose('p1', clicks.p1);
    plain.choose('p2', clicks.p2);
    return sweepTargets(mode, target).every(each => missesOf(plain, start, each) === 0 && critsOf(plain, start, each) === 0);
  });
  expect(seed, 'a seed that hits without a crit').toBeDefined();
  const board = sweepBoard(rules, move, mode, seed, vgc);
  const byStep = Array.from({ length: shape.steps }, (_, step) => {
    const { report, battle } = forcedOn(board, clicks, [{ name: dieOf(move, slot, 'damage-roll'), result: { step } }]);
    expect(report.forced[0].took, `step ${step}`).toBe('applied');
    const hurt = monOf(battle, slot);
    return hurt.maxhp - hurt.hp;
  });
  const byRaw = Array.from({ length: shape.steps }, (_, step) => damageAtRaw(board, clicks, slot, shape.raw(step)));
  expect(byStep).toEqual(byRaw);
  expect(byStep[shape.steps - 1], 'the top step hurts more than step 0').toBeGreaterThan(byStep[0]);
  for (let step = 1; step < shape.steps; step++) expect(byStep[step], `step ${step}`).toBeGreaterThanOrEqual(byStep[step - 1]);
}

describe.each(SWEEP_CASES)('the roll sweep: $name', ({ rules, mode }) => {
  test.each(sweepSelection(SCENES.flatMap(scene => sweepTargets(mode, scene.target).map(slot => ({ ...scene, slot, label: `${scene.id} on ${slot}` }))), 'rows'))('$label', ({ move, target, slot }) => {
    checkRoll(rules, mode, { move, target }, slot, false);
  });
});

describe.each(VGC_RULES.map(rules => ({ rules, name: `${rules.name} VGC` })))('the roll sweep, a team of six: $name', ({ rules }) => {
  test.each(sweepSelection(SCENES.flatMap(scene => sweepTargets('doubles', scene.target).map(slot => ({ ...scene, slot, label: `${scene.id} on ${slot}` }))), 'rows'))('$label', ({ move, target, slot }) => {
    checkRoll(rules, 'doubles', { move, target }, slot, true);
  });
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('the confusion self-hit roll: $name', ({ rules, mode }) => {
  const shape = genShape(rules.generation).roll;
  const outfit = { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) };

  /** A confused Snorlax tackles; the foe splashes. Gens 1 and 2 have no roll for the self-hit (their damage is computed inline). */
  function confusedBoard(seed: string): Battle {
    const attacker = set('Snorlax', ['tackle'], { ...outfit, gender: 'M' });
    const foe = set('Vaporeon', ['splash'], { ...outfit, gender: 'F' });
    const battle = mode === 'singles'
      ? battleOf(rules.singles, [attacker], [foe], seed)
      : battleOf(rules.doubles!, [attacker, set('Blissey', ['splash'], { ...outfit, gender: 'F' })], [foe, set('Vaporeon', ['splash'], { ...outfit, gender: 'F' })], seed);
    battle.sides[0].active[0].addVolatile('confusion');
    return battle;
  }
  const clicks = sweepClicks(mode, 'normal');

  test('every step of the self-hit deals what the simulator deals for its raw value, from the lowest damage up', () => {
    // a seed whose confusion hits the body itself
    const seed = SEEDS.find(candidate => {
      const plain = confusedBoard(candidate);
      plain.choose('p1', clicks.p1);
      plain.choose('p2', clicks.p2);
      return plain.log.some(line => line.startsWith('|-damage|p1a') && line.includes('[from] confusion'));
    });
    expect(seed, 'a seed with a self-hit').toBeDefined();
    const board = confusedBoard(seed!);
    const name = { slot: 'p1a', moveId: 'tackle', targetSlot: 'p1a', kind: 'damage-roll' as const, effectId: 'confusion' };
    const byStep = Array.from({ length: shape.steps }, (_, step) => {
      const { report, battle } = forcedOn(board, clicks, [{ name, result: { step } }]);
      expect(report.forced[0].took, `step ${step}`).toBe('applied');
      const user = monOf(battle, 'p1a');
      return user.maxhp - user.hp;
    });
    expect(byStep).toEqual(Array.from({ length: shape.steps }, (_, step) => damageAtRaw(board, clicks, 'p1a', shape.raw(step))));
    expect(byStep[shape.steps - 1]).toBeGreaterThan(byStep[0]);
    for (let step = 1; step < shape.steps; step++) expect(byStep[step], `step ${step}`).toBeGreaterThanOrEqual(byStep[step - 1]);
  });
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation <= 2))('no confusion roll before Gen 3: $name', ({ rules }) => {
  test('the self-hit of Gens 1 and 2 draws no damage roll: a forced die of it is no draw', () => {
    const outfit = { level: rules.level, gender: rules.generation >= 2 ? 'M' as const : '' as const };
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = battleOf(rules.singles, [set('Snorlax', ['tackle'], outfit)], [set('Vaporeon', ['splash'], outfit)], seed);
      board.sides[0].active[0].addVolatile('confusion');
      const name = { slot: 'p1a', moveId: 'tackle', targetSlot: 'p1a', kind: 'damage-roll' as const, effectId: 'confusion' };
      const { report } = forcedOn(board, sweepClicks('singles', 'normal'), [{ name, result: { step: 5 } }]);
      expect(report.forced[0].took).toBe('no-draw');
    }
  });
});
