import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { calcSingleDamageRange } from '../src/damage-calc';
import { createBranchStateFromBattle } from '../src/branch/state';
import { loadSimMods } from '../src/forward/sim-mods';
import { genShape } from '../src/dice/recognize';
import type { ForcedDie } from '../src/dice/types';
import { seedOf, type Mode, type Rules } from './dice-fixtures';
import { dieOf, forcedOn, monOf, SWEEP_CASES, sweepBoard, sweepClicks, sweepTargets } from './dice-sweep-support';

// Round 82 (forced dice), step A7a: the steps of the damage roll select. The panel shows, for every step of the roll, the damage
// the calculator gives; a forced crit switches the numbers to the crit's. The simulator is the oracle: a turn that forces the
// step (and the crit) deals the damage the calculator lists for it, in every rule set and game type, on every target on its own.
await loadSimMods('gen9championsou');

const SEED = seedOf(3);

/** The calculator takes one Special stat in Gens 1 and 2 (the games have one): the boards give the two the same EVs there. */
const board = (rules: Rules, move: string, mode: Mode): Battle => sweepBoard(
  rules.generation <= 2 ? { ...rules, evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 252, spe: 0 } } : rules, move, mode, SEED,
);
const SCENES = [
  { id: 'a physical move', move: 'strength', target: 'normal' },
  { id: 'a special move', move: 'thunderbolt', target: 'normal' },
  { id: 'a spread move', move: 'rockslide', target: 'allAdjacentFoes' },
];

/** The calculator's reading of the board's first move into one foe, with the rolls. */
function calcRolls(board: Battle, mode: Mode, slot: string, extra: { isCrit?: boolean; hits?: number } = {}) {
  const state = createBranchStateFromBattle(board as never, [], {});
  const attacker = state.p1ActiveSlots![0]!;
  const foes = state.p2ActiveSlots!;
  const defender = foes[slot === 'p2a' ? 0 : 1]!;
  const partner = foes.find(foe => foe !== defender && foe && !foe.fainted) ?? null;
  const move = state.p1MovesBySlot![0][0];
  return calcSingleDamageRange(attacker, defender, move, {
    gen: board.gen, gameType: mode === 'doubles' ? 'Doubles' : 'Singles', rolls: true, ...extra,
    ...(mode === 'doubles' ? { defenderPartner: partner, attackerPartnerAlive: true } : {}),
  });
}

/** What the simulator deals on `slot` when the turn forces the step (and the crit). */
function simulated(board: Battle, mode: Mode, target: string, moveId: string, slot: string, step: number, crit: boolean, hits?: number): number {
  const forced: ForcedDie[] = [
    { name: dieOf(moveId, slot, 'accuracy'), result: { happens: true } },
    { name: dieOf(moveId, slot, 'crit'), result: { happens: crit } },
    { name: dieOf(moveId, slot, 'damage-roll'), result: { step } },
    ...(hits ? [{ name: { slot: 'p1a', moveId, kind: 'hit-count' as const }, result: { hits } }] : []),
  ];
  const { battle } = forcedOn(board, sweepClicks(mode, target), forced);
  const body = monOf(battle, slot);
  return body.maxhp - body.hp;
}

describe.each(SWEEP_CASES)('the calculator rolls: $name', ({ rules, mode }) => {
  const steps = genShape(rules.generation).roll.steps;
  const cases = SCENES.flatMap(scene => sweepTargets(mode, scene.target).map(slot => ({ ...scene, slot, label: `${scene.id} on ${slot}` })));

  test.each(cases)('$label: every step equals the simulator, normal and crit', ({ move, target, slot }) => {
    const battle = board(rules, move, mode);
    for (const crit of [false, true]) {
      const { rolls } = calcRolls(battle, mode, slot, { isCrit: crit });
      expect(rolls, `rolls of the ${crit ? 'crit' : 'hit'}`).toBeDefined();
      expect(rolls!.damage).toHaveLength(steps);
      const dealt = Array.from({ length: steps }, (_, step) => simulated(battle, mode, target, move, slot, step, crit));
      expect(rolls!.damage, crit ? 'crit' : 'hit').toEqual(dealt);
      expect(rolls!.maxhp).toBe(monOf(battle, slot).maxhp);
      expect(rolls!.hp).toBe(monOf(battle, slot).hp);
    }
  });
});

describe.each(SWEEP_CASES)('the calculator rolls of a multi-hit move: $name', ({ rules, mode }) => {
  // The calculator's Champions data (its generation 0) lacks the mod's Past multi-hit moves (`modOverrides` in calc/move.ts copies
  // the power, type, category, flags and target), so the Champions preview prices one hit of Double Kick and Fury Attack. Only the
  // preview reads it (the engine's prices take the simulator's hit count); the rows stand as `fails` and turn red when T300 fixes it.
  const rowTest = rules.name === 'Champions' ? test.fails : test;
  rowTest.each([{ move: 'doublekick', hits: 2 }, { move: 'furyattack', hits: 3 }])('$move: every hit takes the step, the damage is the sum', ({ move, hits }) => {
    const battle = board(rules, move, mode);
    const steps = genShape(rules.generation).roll.steps;
    const { rolls } = calcRolls(battle, mode, 'p2a', { hits });
    expect(rolls).toBeDefined();
    expect(rolls!.hits).toBe(hits);
    const dealt = Array.from({ length: steps }, (_, step) => simulated(battle, mode, 'normal', move, 'p2a', step, false, move === 'furyattack' ? hits : undefined));
    expect(rolls!.damage).toEqual(dealt);
  });
});

describe('the rolls are asked for', () => {
  test('a result carries rolls only when the context asks, and the crit moves the range', () => {
    const gen9 = SWEEP_CASES.find(entry => entry.rules.name === 'Gen 9' && entry.mode === 'singles')!;
    const state = createBranchStateFromBattle(board(gen9.rules, 'strength', 'singles') as never, [], {});
    const args = [state.p1ActiveSlots![0]!, state.p2ActiveSlots![0]!, state.p1MovesBySlot![0][0]] as const;
    const plain = calcSingleDamageRange(...args, { gen: 9 });
    expect('rolls' in plain).toBe(false);
    const crit = calcSingleDamageRange(...args, { gen: 9, isCrit: true });
    expect(crit.maxPercent).toBeGreaterThan(plain.maxPercent);
    expect(calcSingleDamageRange(...args, { gen: 9, isCrit: false })).toEqual(plain);
  });
});
