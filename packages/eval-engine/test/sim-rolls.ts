import { createMatchupCache } from '../src/eval-function';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { drawPair } from '../src/pair/draw';


export interface SimDamages {
  /** Index i = the damage of random(16) = i (0 is the top roll). */
  normal: number[];
  crit: number[];
}

export interface HitKey {
  /** `${attackerSlot}:${moveId}>${targetSlot}`, e.g. `p1a:hydropump>p2a`. */
  script: string;
  target: { side: 0 | 1; slot: number };
}

export function simDamages(root: SimPosition, p1Choice: string, p2Choice: string, key: HitKey, seed = '1,2,3,4'): SimDamages {
  const damageOf = (roll: number, crit: boolean): number => {
    const scripts = new Map([[key.script, { hit: true, crit, roll }]]);
    const drawn = drawPair(root, p1Choice, p2Choice, seed as never, scripts, createMatchupCache());
    const hit = drawn.records.find(record => record.kind === 'roll' && record.key === key.script);
    if (!hit || hit.kind !== 'roll') throw new Error('the scripted hit never rolled');
    return hit.snapshot.defender.hp - positionBattle(drawn.child).sides[key.target.side].active[key.target.slot]!.hp;
  };
  const rolls = Array.from({ length: 16 }, (_, roll) => roll);
  return { normal: rolls.map(roll => damageOf(roll, false)), crit: rolls.map(roll => damageOf(roll, true)) };
}

export const killing = (damages: readonly number[], hp: number): number => damages.filter(damage => damage >= hp).length;

export function strengthSeeds(root: SimPosition, p1Choice: string, p2Choice: string, marker: string): { weak: string; strong: string } {
  let weak: string | undefined;
  let strong: string | undefined;
  for (let index = 1; index <= 400 && !(weak && strong); index++) {
    const seed = `${index},2,3,4`;
    const drawn = drawPair(root, p1Choice, p2Choice, seed as never, new Map(), createMatchupCache());
    if (drawn.log.some(line => line.includes(marker))) strong ??= seed;
    else weak ??= seed;
  }
  if (!weak || !strong) throw new Error('the strength draw never came out both ways');
  return { weak, strong };
}
