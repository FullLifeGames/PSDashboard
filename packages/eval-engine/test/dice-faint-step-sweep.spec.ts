import { PRNG } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { faintStep } from '../src/dice/logged-block';
import { loadSimMods } from '../src/forward/sim-mods';
import { genShape } from '../src/dice/recognize';
import type { ForcedDie } from '../src/dice/types';
import { extractProtocolEvents, isPerfectAlignment, scoreAlignment } from '../src/hax-alignment';
import { dieOf, forcedOn, monOf, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove } from './dice-sweep-support';
import type { Mode, Rules } from './dice-fixtures';

/**
 * Round 86 (the engine reads the dice), lane B, step B4a (T306): the faint step against the simulator, in every rule set the corpus plays
 * (Gens 1 to 9 and the Champions mod, singles and doubles). The scene is a one-hit knockout that only the top of the damage roll gives:
 * Snorlax hits a Vaporeon whose hit points equal the hardest hit. Two logs come from it, one per direction. In the first the log's roll
 * knocked the Vaporeon out and the hidden dice of another seed leave it standing; in the second the log's roll left it standing and the
 * other seed's roll knocks it out. The faint step must find a roll step under which the forced turn is the log's turn (a perfect score),
 * for the 16 steps of Gens 3 and up and for the 39 values of Gens 1 and 2 alike, in at most 16 plays.
 */

/** A move that is a plain physical hit: Normal type, one foe, always accurate, no side effect, no extra draw, no priority. */
const isPlainShape = (move: DexMove): boolean =>
  move.category === 'Physical' && move.type === 'Normal' && move.target === 'normal' && move.accuracy === 100
  && move.basePower >= 60 && move.basePower <= 100 && move.priority === 0;
const hasNoExtra = (move: DexMove): boolean =>
  !move.secondary && !move.secondaries && !move.multihit && !move.drain && !move.recoil && !move.self && !move.selfdestruct
  && !move.flags.charge && !move.flags.recharge && !move.willCrit && !move.ohko && !move.damage
  && !move.basePowerCallback && !move.onModifyMove && !move.onBasePower;

/** A move the scene can use in a rule set, read from the Dex. */
function plainHit(rules: Rules): DexMove | undefined {
  return sweepMoves(rules, move => !move.isNonstandard && isPlainShape(move) && hasNoExtra(move)).moves.sort((x, y) => x.id.localeCompare(y.id))[0];
}

await loadSimMods('gen9championsou');

const SEEDS = ['1,2,3,4', '5,9,13,17', '2,4,6,8', '11,7,5,3', '17,29,41,53', '8,16,32,64', '101,3,7,19', '23,42,17,88'];
const LOG_SEED = '31,41,59,26';

/** The scene in one rule set: the board, the dice of the log's turn, and what a step of the roll costs the Vaporeon. */
function sceneOf(rules: Rules, mode: Mode, move: DexMove) {
  const clicks = sweepClicks(mode, 'normal');
  const fixed: ForcedDie[] = [
    { name: dieOf(move.id, 'p2a', 'crit'), result: { happens: false } },
    { name: dieOf(move.id, 'p2a', 'accuracy'), result: { happens: true } },
  ];
  const roll = (step: number): ForcedDie => ({ name: dieOf(move.id, 'p2a', 'damage-roll'), result: { step } });
  const board = (seed: string, hp: number | null) => {
    const battle = sweepBoard(rules, move.id, mode, seed);
    battle.prng = new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
    if (hp !== null) monOf(battle, 'p2a').hp = hp;
    return battle;
  };
  const lost = (step: number): number => {
    const { battle } = forcedOn(board(LOG_SEED, null), clicks, [...fixed, roll(step)]);
    const target = monOf(battle, 'p2a');
    return target.maxhp - target.hp;
  };
  const events = (hp: number, dice: ForcedDie[], seed: string) => {
    const { battle, start } = forcedOn(board(seed, hp), clicks, dice);
    return extractProtocolEvents(battle.log.slice(start));
  };
  return { clicks, fixed, roll, board, lost, events, lastStep: genShape(rules.generation).roll.steps - 1 };
}

describe.each(SWEEP_CASES)('the faint step finds the roll that gives the knockout the log shows: $name', ({ rules, mode }) => {
  const move = plainHit(rules);

  test('the rule set has a move for the scene', () => {
    expect(move?.id, `${rules.name}: a plain physical hit`).toBeTruthy();
  });
  if (!move) return;

  const scene = sceneOf(rules, mode as Mode, move);
  const { fixed, roll, board, lost, events, lastStep } = scene;

  test.each([
    { direction: 'the log knocks the Vaporeon out, the hidden dice leave it standing', hp: () => lost(lastStep), logStep: lastStep, naturalFaints: false },
    { direction: 'the log leaves the Vaporeon standing, the hidden dice knock it out', hp: () => lost(0) + 1, logStep: 0, naturalFaints: true },
  ])('$direction', ({ hp, logStep, naturalFaints }) => {
    expect(lost(lastStep), `${rules.name}: the top of the roll hits harder than the bottom`).toBeGreaterThan(lost(0));
    const hitPoints = hp();
    const expected = events(hitPoints, [...fixed, roll(logStep)], LOG_SEED);
    expect(expected.faints.size, 'the log turn').toBe(naturalFaints ? 0 : 1);
    const witnesses = SEEDS.filter(seed => (events(hitPoints, fixed, seed).faints.size > 0) === naturalFaints);
    expect(witnesses.length, `${rules.name}: seeds whose hidden dice differ from the log`).toBeGreaterThan(0);
    for (const seed of witnesses) {
      const result = faintStep({ battle: board(seed, hitPoints), expected, seed: seed as never, choices: scene.clicks }, fixed);
      expect(result.dice, `${rules.name} seed ${seed}: a step set that gives the log's turn`).not.toBeNull();
      expect(result.dice!.some(die => die.name.kind === 'damage-roll'), `${rules.name} seed ${seed}: a damage-roll die was added`).toBe(true);
      expect(result.plays, 'at most one trial of the natural turn and fifteen of the steps').toBeLessThanOrEqual(16);
      expect(isPerfectAlignment(scoreAlignment(expected, events(hitPoints, result.dice!, seed))), `${rules.name} seed ${seed}`).toBe(true);
    }
  });
  // Round 86 (ruling C1): the log's turn also holds a soft mismatch no die mends (here a flinch the log shows and the simulator never plays).
  // No step set is perfect then, but the one that gives the log's faint stands, and the seed search that follows finds nothing strictly better.
  test.each([
    { direction: 'the log knocks the Vaporeon out, the hidden dice leave it standing', hp: () => lost(lastStep), logStep: lastStep, naturalFaints: false },
    { direction: 'the log leaves the Vaporeon standing, the hidden dice knock it out', hp: () => lost(0) + 1, logStep: 0, naturalFaints: true },
  ])('with a soft mismatch no die mends: $direction', ({ hp, logStep, naturalFaints }) => {
    const hitPoints = hp();
    const expected = events(hitPoints, [...fixed, roll(logStep)], LOG_SEED);
    expected.cants.set('p2:vaporeon:flinch', 1);
    const witnesses = SEEDS.filter(seed => (events(hitPoints, fixed, seed).faints.size > 0) === naturalFaints);
    for (const seed of witnesses) {
      const result = faintStep({ battle: board(seed, hitPoints), expected, seed: seed as never, choices: scene.clicks }, fixed);
      expect(result.dice, `${rules.name} seed ${seed}: the step set that gives the log's faint`).not.toBeNull();
      expect(result.dice!.some(die => die.name.kind === 'damage-roll'), `${rules.name} seed ${seed}: a damage-roll die was added`).toBe(true);
      expect(result.seed, `${rules.name} seed ${seed}: the seed stays, the steps fit`).toBe(seed);
      const score = scoreAlignment(expected, events(hitPoints, result.dice!, seed));
      expect({ faint: score.faintMismatches, ended: score.endedMismatch, soft: score.softMismatches }, `${rules.name} seed ${seed}`).toEqual({ faint: 0, ended: false, soft: 1 });
    }
  });
});
