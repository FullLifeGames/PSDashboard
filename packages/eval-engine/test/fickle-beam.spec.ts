import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { planCellEvents } from '../src/cell-blend';
import { strengthMix } from '../src/calc/fickle';
import { calcSingleDamageRange } from '../src/damage-calc';
import { createMatchupCache } from '../src/eval-function';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { boundaryEvent, critRate } from '../src/ko-odds';
import { drawPair } from '../src/pair/draw';
import { killTable } from '../src/pair/kill-table';
import { pairKoOdds } from '../src/pair/odds';
import { readPattern } from '../src/pair/pattern';
import type { PairScript } from '../src/pair/prng';
import { pairCellSample } from '../src/pair/sampler';
import { rollSet as set, rootOf } from './calc-roll-oracle';
import { killing, simDamages, strengthSeeds, type SimDamages } from './sim-rolls';

/**
 * Round 69, lane D (T154): Fickle Beam doubles in power on 30 % of its uses
 * (the Dex move's onBasePower asks randomChance(3, 10) and chains a factor of
 * 2), which the calculator does not know. The chance and the factor are read
 * from the Dex handler; the engine prices the move as the mix of its two
 * strengths, each with its 16 rolls and its crits. The oracle is the
 * simulator's own damage, drawn on a seed where the stronger strength came
 * out and one where it did not (sim-rolls.ts).
 */

const MARKER = 'move: Fickle Beam';
const dragonite = (): PokemonSet => set('Dragonite', ['Fickle Beam', 'Dragon Pulse', 'Splash']);
const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });

describe('the strength mix is read from the Dex handler', () => {
  const dex = Dex.forGen(9);

  test('Fickle Beam: 3 of 10 and a factor of 2; moves without a draw: none', () => {
    expect(strengthMix(dex, 'Fickle Beam')).toEqual({ numerator: 3, denominator: 10, chance: 0.3, factor: 2 });
    // Dragon Pulse has no onBasePower; Venoshock has one without a chance draw; Expanding Force's needs the battle.
    for (const name of ['Dragon Pulse', 'Venoshock', 'Expanding Force', 'Earthquake', 'Splash']) expect(strengthMix(dex, name)).toBeNull();
  });

  test('the simulator doubles the damage at that rate: 200 natural draws, the damage roll scripted', () => {
    const mix = strengthMix(dex, 'Fickle Beam')!;
    const root = rootOf('gen9customgame', [dragonite()], [wall()]);
    let strong = 0;
    const damages = new Set<number>();
    for (let index = 1; index <= 200; index++) {
      const scripts = new Map([['p1a:ficklebeam>p2a', { hit: true, crit: false, roll: 0 }]]);
      const drawn = drawPair(root, 'move ficklebeam', 'move splash', `${index},2,3,4` as never, scripts, createMatchupCache());
      if (drawn.log.some(line => line.includes(MARKER))) strong += 1;
      const hit = drawn.records.find(record => record.kind === 'roll');
      if (hit?.kind === 'roll') damages.add(hit.snapshot.defender.hp - positionBattle(drawn.child).sides[1].active[0]!.hp);
    }
    expect(Math.abs(strong - 200 * mix.chance)).toBeLessThan(3 * Math.sqrt(200 * mix.chance * (1 - mix.chance)));
    // Two damages only: the weak one and the doubled one.
    expect(damages.size).toBe(2);
  });
});

describe('singles: the event is the mix of the two strengths', () => {
  const crit = critRate(9, 1)!;
  const choice = 'move ficklebeam';
  const key = { script: 'p1a:ficklebeam>p2a', target: { side: 1 as const, slot: 0 } };
  const make = (hp?: number): SimPosition => rootOf('gen9customgame', [dragonite()], [wall()], battle => { if (hp) battle.sides[1].active[0]!.sethp(hp); });
  const seeds = strengthSeeds(make(), choice, 'move splash', MARKER);
  const weak = simDamages(make(), choice, 'move splash', key, seeds.weak);
  const strong = simDamages(make(), choice, 'move splash', key, seeds.strong);
  const m = strengthMix(Dex.forGen(9), 'Fickle Beam')!.chance;

  const expected = (hp: number) => {
    const share = (damages: SimDamages) => (1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16;
    return (1 - m) * share(weak) + m * share(strong);
  };
  const event = (hp: number) => {
    const battle = positionBattle(make(hp));
    return boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'ficklebeam')!;
  };

  test('the doubled strength hits harder', () => {
    expect(Math.min(...strong.normal)).toBeGreaterThan(Math.max(...weak.normal));
  });

  test.each([
    ['only the doubled strength kills', () => [...strong.normal].sort((a, b) => a - b)[8]],
    ['both strengths kill some rolls', () => [...weak.normal].sort((a, b) => a - b)[8]],
    ['neither kills', () => Math.max(...strong.crit) + 1],
  ])('%s: the kill fraction is 0.7 of the weak and 0.3 of the doubled shares', (_name, hpOf) => {
    const hp = hpOf();
    expect(event(hp).killFraction).toBeCloseTo(expected(hp), 10);
    expect(event(hp).pKill).toBeCloseTo(expected(hp), 10);
  });

  test('the cell plan\'s class weights follow the mix', () => {
    const hp = [...strong.normal].sort((a, b) => a - b)[8];
    const plan = planCellEvents(positionBattle(make(hp)), choice, 'move splash');
    expect(plan.kind).toBe('events');
    if (plan.kind === 'events') expect(plan.events[0].event.killFraction).toBeCloseTo(expected(hp), 10);
  });

  test('a move without the draw is priced as the simulator rolls it, as before', () => {
    const pulse = { script: 'p1a:dragonpulse>p2a', target: key.target };
    const damages = simDamages(make(), 'move dragonpulse', 'move splash', pulse);
    const hp = [...damages.normal].sort((a, b) => a - b)[8];
    const battle = positionBattle(make(hp));
    const odds = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'dragonpulse')!;
    expect(odds.normalKillRolls).toBe(killing(damages.normal, hp));
    expect(odds.critKillRolls).toBe(killing(damages.crit, hp));
  });

  test('the preview spans both strengths: the weak minimum to the doubled maximum', () => {
    const battle = positionBattle(make());
    const state = createBranchStateFromBattle(battle, [], {});
    const [mon, foe] = [state.p1ActiveSlots[0]!, state.p2ActiveSlots[0]!];
    const option = { name: 'Fickle Beam', activeSlot: 0, slot: 1, pp: 8, maxpp: 8, disabled: false, type: 'Dragon', targetType: 'normal', requiresTarget: false, targetOptions: [] };
    const result = calcSingleDamageRange(mon, foe, option as never, { gen: 9, gameType: 'Singles' });
    const pct = (damage: number) => Math.round(damage / foe.maxhp * 1000) / 10;
    expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...weak.normal)), pct(Math.max(...strong.normal))]);
  });
});

describe('doubles: the headline mixes the strengths too', () => {
  const crit = critRate(9, 1)!;
  const choice = 'move ficklebeam 1, move splash';
  const idle = 'move splash, move splash';
  const make = (hp?: number): SimPosition => rootOf('gen9doublescustomgame', [dragonite(), wall('Snorlax')], [wall(), wall('Chansey')], battle => { if (hp) battle.sides[1].active[0]!.sethp(hp); });
  const key = { script: 'p1a:ficklebeam>p2a', target: { side: 1 as const, slot: 0 } };
  const seeds = strengthSeeds(make(), choice, idle, MARKER);
  const weak = simDamages(make(), choice, idle, key, seeds.weak);
  const strong = simDamages(make(), choice, idle, key, seeds.strong);
  const m = strengthMix(Dex.forGen(9), 'Fickle Beam')!.chance;

  test('pairKoOdds equals 0.7 of the weak and 0.3 of the doubled shares', () => {
    const hp = [...strong.normal].sort((a, b) => a - b)[8];
    const share = (damages: SimDamages) => (1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16;
    const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [choice]);
    expect(odds?.killFraction).toBeCloseTo((1 - m) * share(weak) + m * share(strong), 10);
  });
});

describe('doubles: the pair plan reads the strength the dice drew', () => {
  const crit = critRate(9, 1)!;
  const choice = 'move ficklebeam 1, move splash';
  const idle = 'move splash, move splash';
  const key = { script: 'p1a:ficklebeam>p2a', target: { side: 1 as const, slot: 0 } };
  const mix = strengthMix(Dex.forGen(9), 'Fickle Beam')!;
  const base = (): SimPosition => rootOf('gen9doublescustomgame', [dragonite(), wall('Snorlax')], [wall(), wall('Chansey')]);
  const seeds = strengthSeeds(base(), choice, idle, MARKER);
  const weak = simDamages(base(), choice, idle, key, seeds.weak);
  const strong = simDamages(base(), choice, idle, key, seeds.strong);
  // Only the doubled strength kills: the median of its rolls.
  const hp = [...strong.normal].sort((a, b) => a - b)[8];
  const root = rootOf('gen9doublescustomgame', [dragonite(), wall('Snorlax')], [wall(), wall('Chansey')], battle => { battle.sides[1].active[0]!.sethp(hp); });
  const share = (damages: SimDamages) => (1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16;
  const pKill = (1 - mix.chance) * share(weak) + mix.chance * share(strong);
  const dex = positionBattle(root).dex;
  const tableFor = (snapshot: Parameters<typeof killTable>[0]) => killTable(snapshot);
  const readAt = (seed: string, scripts: ReadonlyMap<string, PairScript> = new Map()) => {
    const drawn = drawPair(root, choice, idle, seed as never, scripts, createMatchupCache());
    return { drawn, read: readPattern(drawn.records, drawn.log, dex, tableFor) };
  };

  test('a weak and a doubled draw both read as classes whose odds are the mix', () => {
    expect(pKill).toBeGreaterThan(0);
    expect(pKill).toBeLessThan(1);
    for (const seed of [seeds.weak, seeds.strong]) {
      const { read } = readAt(seed);
      expect(read.kind).toBe('pattern');
      if (read.kind !== 'pattern') continue;
      const [event] = read.events;
      expect(event.probability).toBeCloseTo(event.outcome === 'hit-kill' ? pKill : 1 - pKill, 10);
    }
  });

  test('the alternative class is drawn by a script that names the strength, and lands', () => {
    const { read } = readAt(seeds.weak);
    if (read.kind !== 'pattern') throw new Error('the weak draw must read as a pattern');
    const [event] = read.events;
    expect(event.outcome).toBe('hit-nokill');
    const kill = event.alternatives.find(alternative => alternative.outcome === 'hit-kill')!;
    expect(kill.probability).toBeCloseTo(pKill, 10);
    expect(kill.script.doubled).toBe(true);
    const again = readAt(seeds.weak, new Map([[event.key, kill.script]]));
    expect(again.read.kind === 'pattern' && again.read.events[0].outcome).toBe('hit-kill');
  });

  test('the cell is priced as a plan whose kill class weighs the mix', () => {
    const cell = pairCellSample(root, choice, idle, 3, createMatchupCache());
    expect(cell.kind).toBe('sample');
    if (cell.kind !== 'sample') return;
    expect(cell.via).toBe('plan');
    const classes = cell.sample.blend!.classes;
    expect(classes.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 10);
    expect(classes.find(entry => entry.key.endsWith('=hit-kill'))?.weight).toBeCloseTo(pKill, 10);
  });
});
