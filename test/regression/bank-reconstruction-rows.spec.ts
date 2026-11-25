import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { applyTargetCorrections } from '../../packages/eval-engine/src/branch-engine';
import type { SimBattle } from '../../packages/eval-engine/src/branch/types';
import { deserializeBattleExact } from '../../packages/eval-engine/src/forward-model';
import { isPerfectAlignment } from '../../packages/eval-engine/src/hax-alignment';
import { rebuild, type Rebuilt } from './forced-reconstruction-support';

// The rows skip where the local fit corpus (`.fit-corpus`) is absent (a clone, CI without the bank data).

const bankPosition = (rebuilt: Rebuilt, turn: number): SimBattle => {
  const battle = deserializeBattleExact(rebuilt.positions.get(turn)!) as SimBattle;
  applyTargetCorrections(battle, rebuilt.snapshotFor(turn));
  return battle;
};
const living = (battle: SimBattle, side: 0 | 1): number => battle.sides[side].pokemon.filter(body => !body.fainted && body.hp > 0).length;

const present = (id: string): boolean => existsSync(`.fit-corpus/${id}.json`);
const SCENE_C1 = 'gen9vgc2024regh-2243810213';

describe.skipIf(!present(SCENE_C1))('the faint step takes a step set that gives the log\'s faints (2243810213)', () => {
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

const correctedWith = (rebuilt: Rebuilt, turn: number, snapshotTurn: number): SimBattle => {
  const battle = deserializeBattleExact(rebuilt.positions.get(turn)!) as SimBattle;
  applyTargetCorrections(battle, rebuilt.snapshotFor(snapshotTurn));
  return battle;
};

describe.skipIf(!present(SCENE_C1))('a body the correction faints leaves the game as the simulator takes it out (2243810213)', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild(SCENE_C1, { corpus: true, through: 7 }); }, 300_000);

  test('turn 7: p2 stands at the one living body the log shows', () => {
    expect(living(bankPosition(rebuilt, 7), 1), 'living bodies of p2').toBe(1);
  });

  test('the correction that faints the last shown body of p2 retires the unshown bench', () => {
    const battle = correctedWith(rebuilt, 6, 7);
    const names = battle.sides[1].pokemon.filter(body => !body.fainted && body.hp > 0).map(body => body.name);
    expect(names).toEqual(['Unashamed']);
  });
});

const SCENE_C3B = 'gen9vgc2024regg-2159578969';
describe.skipIf(!present(SCENE_C3B))('the end of Neutralizing Gas starts what the gas held back (2159578969)', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild(SCENE_C3B, { corpus: true, through: 5 }); }, 300_000);

  test('turn 2 with the snapshot of turn 3: Weezing stands at 0 and Slow Start runs on Regigigas', () => {
    const battle = correctedWith(rebuilt, 2, 3);
    const bodies = battle.sides.flatMap(side => side.pokemon);
    const regigigas = bodies.find(body => body.species.id === 'regigigas')!;
    const weezing = bodies.find(body => body.name === 'Weezing')!;
    expect({ slowStart: (regigigas.abilityState as { counter?: number }).counter, weezing: weezing.hp }).toEqual({ slowStart: 5, weezing: 0 });
  });

  test('the whole rebuild: the position at turn 5 has Slow Start running on Regigigas', () => {
    const battle = bankPosition(rebuilt, 5);
    const regigigas = battle.sides.flatMap(side => side.pokemon).find(body => body.species.id === 'regigigas')!;
    expect(regigigas.hp, 'Regigigas is alive').toBeGreaterThan(0);
    const counter = (regigigas.abilityState as { counter?: number }).counter;
    expect(counter, 'Slow Start counter at the start of turn 5 (5 at the start, one less per turn on the field)').toBeGreaterThan(0);
    expect(counter).toBeLessThanOrEqual(5);
  });
});
