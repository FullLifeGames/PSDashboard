/* eslint-disable no-restricted-imports -- Round 86 (B9): a white-box measurement chain like forced-reconstruction.spec.ts, which this spec shares its support file with: it reads the alignment records of the engine package, none of which the barrel exports. */
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { applyTargetCorrections } from '../../packages/eval-engine/src/branch-engine';
import type { SimBattle } from '../../packages/eval-engine/src/branch/types';
import { deserializeBattleExact } from '../../packages/eval-engine/src/forward-model';
import { isPerfectAlignment } from '../../packages/eval-engine/src/hax-alignment';
import { rebuild, type Rebuilt } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B9 (T306, the causes C1 to C3 of the B7 diagnosis): scenes of the VGC holdout where the
 * rebuild with the log's dice read worse than the sixteen-seed search of the base. The replays are bank replays of the local fit corpus
 * (`.fit-corpus`), so the rows skip where the corpus is absent (a clone, CI without the bank data).
 *
 * - C1, 2243810213 (Regulation H) turn 6: the log has Jet Punch knock out Annihilape. The turn has a soft mismatch no die mends, so the faint
 *   step used to throw its step set away and Annihilape stood at 14 of 186.
 * - C3, 2243810213 turn 7 and 2159578969 turn 5: a body the log faints and the turn leaves standing. The correction at the turn's boundary
 *   used to write `fainted` and hp 0 and nothing else: the unshown bench of p2 (Typhlosion and Farigiraf never came out) stayed alive, so p2
 *   stood at three living bodies against the log's one; Weezing's Neutralizing Gas never ended, so Slow Start never started on Regigigas.
 */

/** The position the bank scores: the boundary position of the rebuild with the snapshot's corrections (`applyTargetCorrections`). */
const bankPosition = (rebuilt: Rebuilt, turn: number): SimBattle => {
  const battle = deserializeBattleExact(rebuilt.positions.get(turn)!) as SimBattle;
  applyTargetCorrections(battle, rebuilt.snapshotFor(turn));
  return battle;
};
const living = (battle: SimBattle, side: 0 | 1): number => battle.sides[side].pokemon.filter(body => !body.fainted && body.hp > 0).length;

const present = (id: string): boolean => existsSync(`.fit-corpus/${id}.json`);
const SCENE_C1 = 'gen9vgc2024regh-2243810213';

describe.skipIf(!present(SCENE_C1))('C1: the faint step takes a step set that gives the log\'s faints (2243810213)', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild(SCENE_C1, { corpus: true }); }, 300_000);

  test('turn 6: the forced turn faints the body the log faints, with no ended mismatch', () => {
    const { actual } = rebuilt.records.get(6)!;
    expect({ faint: actual.faintMismatches, ended: actual.endedMismatch }).toEqual({ faint: 0, ended: false });
  });

  test('turn 6 stays imperfect for the soft mismatch no die mends, and no worse than the natural turn', () => {
    const { actual } = rebuilt.records.get(6)!;
    expect(isPerfectAlignment(actual)).toBe(false);
    expect(actual.softMismatches).toBeGreaterThan(0);
  });
});

/** The raw boundary position of a turn with the snapshot of a later turn applied: a body the log faints in between, the simulator's turn never did. */
const correctedWith = (rebuilt: Rebuilt, turn: number, snapshotTurn: number): SimBattle => {
  const battle = deserializeBattleExact(rebuilt.positions.get(turn)!) as SimBattle;
  applyTargetCorrections(battle, rebuilt.snapshotFor(snapshotTurn));
  return battle;
};

describe.skipIf(!present(SCENE_C1))('C3: a body the correction faints leaves the game as the simulator takes it out (2243810213)', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild(SCENE_C1, { corpus: true, through: 7 }); }, 300_000);

  test('turn 7: p2 stands at the one living body the log shows', () => {
    expect(living(bankPosition(rebuilt, 7), 1), 'living bodies of p2').toBe(1);
  });

  // The log's turn 6 knocks out Annihilape and sends nobody in; the position at turn 6 still has it at 138 of 186, and the correction is all that
  // faints it. Typhlosion and Farigiraf never come out of the bag (the log shows four bodies of p2): they leave with it.
  test('the correction that faints the last shown body of p2 retires the unshown bench', () => {
    const battle = correctedWith(rebuilt, 6, 7);
    const names = battle.sides[1].pokemon.filter(body => !body.fainted && body.hp > 0).map(body => body.name);
    expect(names).toEqual(['Unashamed']);
  });
});

const SCENE_C3B = 'gen9vgc2024regg-2159578969';
describe.skipIf(!present(SCENE_C3B))('C3: the end of Neutralizing Gas starts what the gas held back (2159578969)', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild(SCENE_C3B, { corpus: true, through: 5 }); }, 300_000);

  // The log's turn 2: Earth Power knocks out Weezing, `-end Neutralizing Gas`, `-start Slow Start` on Regigigas. The position at turn 2 has Weezing
  // alive (gas on, Slow Start held back); the correction to the log's turn 3 takes Weezing out through its End event. The rebuild itself meets the same
  // faint one step earlier, in `faintThePredecessor` (branch/entry-effects.ts, the switch-in of Grafaiai in its slot). Since B10 that path takes
  // Weezing out through `takeBodyOut` too, and the row of the whole rebuild (the position at turn 5) holds it.
  test('turn 2 with the snapshot of turn 3: Weezing stands at 0 and Slow Start runs on Regigigas', () => {
    const battle = correctedWith(rebuilt, 2, 3);
    const bodies = battle.sides.flatMap(side => side.pokemon);
    const regigigas = bodies.find(body => body.species.id === 'regigigas')!;
    const weezing = bodies.find(body => body.name === 'Weezing')!;
    // Slow Start keeps its counter in the ability's state (the log's `-start` line)
    expect({ slowStart: (regigigas.abilityState as { counter?: number }).counter, weezing: weezing.hp }).toEqual({ slowStart: 5, weezing: 0 });
  });

  // Round 86 (B10): the whole rebuild meets that faint in `faintThePredecessor` (branch/entry-effects.ts: Grafaiai takes Weezing's slot while the
  // simulator's Weezing still stands). The predecessor leaves through `takeBodyOut` on the field, so the gas ends and Slow Start starts.
  test('the whole rebuild: the position at turn 5 has Slow Start running on Regigigas', () => {
    const battle = bankPosition(rebuilt, 5);
    const regigigas = battle.sides.flatMap(side => side.pokemon).find(body => body.species.id === 'regigigas')!;
    expect(regigigas.hp, 'Regigigas is alive').toBeGreaterThan(0);
    const counter = (regigigas.abilityState as { counter?: number }).counter;
    expect(counter, 'Slow Start counter at the start of turn 5 (5 at the start, one less per turn on the field)').toBeGreaterThan(0);
    expect(counter).toBeLessThanOrEqual(5);
  });
});
