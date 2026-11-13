import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { advancePosition, createRootPosition, positionBattle } from '../src/forward-model';
import { countFainted, leafValue } from '../src/search/leaf';
import { sampleCell, type CellSample } from '../src/search/cell-sampler';
import { FALLBACK_SEEDS, PAIR_DRAW_BUDGET, pairCellSample, type PairCell } from '../src/pair/sampler';
import { cellSeeds } from '../src/search/root-quantile';
import { anchorRoot, doublesRoot, pairSet, PLAYED, QUIET } from './pair-battles';

const meanOver = (root: ReturnType<typeof anchorRoot>, p1: string, p2: string, seeds: readonly string[]) => {
  const cache = createMatchupCache();
  return seeds.reduce((sum, seed) => sum + leafValue(positionBattle(advancePosition(root, p1, p2, seed as never)), cache), 0) / seeds.length;
};

const seeds = (count: number) => Array.from({ length: count }, (_, k) => `${101 + 4 * k},${102 + 4 * k},${103 + 4 * k},${104 + 4 * k}`);

/**
 * A sample as data: the children by their serialized identity (the live battle behind each carries per-run
 * state such as |t:| lines) — the first child, and since round 63 the class children the verify step deepens.
 */
const asData = (sample: CellSample) => ({
  ...sample, firstChild: sample.firstChild.serialized,
  classChildren: sample.classChildren && [...sample.classChildren].map(([key, child]) => [key, child.serialized]),
});
const cellData = (cell: PairCell) => (cell.kind === 'sample' ? { ...cell, sample: asData(cell.sample) } : cell);

describe('the pair plan at the root (round 56)', () => {
  test('the anchor\'s played cell prices the Play Rough kill: within 0.05 of 256 seeds, where one seed missed by 0.53', { timeout: 60_000 }, () => {
    const root = anchorRoot();
    const cell = pairCellSample(root, ...PLAYED, 1, createMatchupCache());
    expect(cell.kind).toBe('sample');
    if (cell.kind !== 'sample') return;
    expect(cell.via).toBe('plan');
    expect(cell.draws).toBeLessThanOrEqual(PAIR_DRAW_BUDGET);
    const truth = meanOver(root, ...PLAYED, seeds(256));
    expect(Math.abs(cell.sample.value - truth)).toBeLessThan(0.05);
    const blend = cell.sample.blend!;
    expect(blend.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    // Round 86 (T305): the first draw burned the Matcha Gotcha's target, so its class names the burn (old key: `...=hit-nokill`).
    // r89 A5 gate: the first draw is slot 0 of the cell's own list now (T324); it kills with Play Rough and burns nobody. Old key:
    // 'p1b:playrough>p2b=miss|p2a:matchagotcha>p1b=hit-nokill+brn'.
    expect(blend.classes.find(cls => cls.hasFirst)?.key).toBe('p1b:playrough>p2b=hit-kill|p2a:matchagotcha>p1a=hit-nokill|p2a:matchagotcha>p1b=hit-nokill');
  });

  test('sampleCell routes a doubles root cell through the plan and stays the same when computed twice', () => {
    const root = anchorRoot();
    const battle = positionBattle(root);
    const once = sampleCell(root, countFainted(battle), ...PLAYED, 1, createMatchupCache(), true);
    const twice = sampleCell(root, countFainted(battle), ...PLAYED, 1, createMatchupCache(), true);
    expect(asData(twice)).toEqual(asData(once));
    expect(once.blend).toBeDefined();
  });

  test('a quiet cell keeps today\'s value: the first seed\'s leaf', () => {
    const root = anchorRoot();
    const battle = positionBattle(root);
    expect(pairCellSample(root, ...QUIET, 1, createMatchupCache()).kind).toBe('plain');
    const cell = sampleCell(root, countFainted(battle), ...QUIET, 1, createMatchupCache(), true);
    expect(cell.value).toBe(meanOver(root, ...QUIET, ['1,2,3,4']));
    expect(cell.blend).toBeUndefined();
  });

  test('without blendRoot a doubles cell stays on the plain path (sub-searches)', () => {
    const root = anchorRoot();
    const battle = positionBattle(root);
    const cell = sampleCell(root, countFainted(battle), ...PLAYED, 1, createMatchupCache());
    // r89 A5 gate: was the mean over the fixed seed '1,2,3,4' (-0.6562485351511125); the cell's slot 0 prices -0.17427480662206596.
    expect(cell.value).toBe(meanOver(root, ...PLAYED, cellSeeds(root, ...PLAYED).slice(0, 1)));
  });

  test('a paralyzed attacker falls back before any draw: the plain mean over the eight fallback seeds', () => {
    const root = doublesRoot(
      [pairSet('Act', 'Garchomp', ['Dragon Claw', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('A', 'Snorlax', ['Rest', 'Protect']), pairSet('B', 'Snorlax', ['Rest', 'Protect'])],
      battle => { battle.sides[0].active[0]!.setStatus('par'); },
    );
    const cell = pairCellSample(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest', 1, createMatchupCache());
    expect(cell).toMatchObject({ kind: 'sample', via: 'fallback', reason: 'prevented:par', draws: 8 });
    if (cell.kind !== 'sample') return;
    expect(cell.sample.value).toBeCloseTo(meanOver(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest', cellSeeds(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest').slice(0, FALLBACK_SEEDS.length)), 12); // r89 A5 gate: the cell's eight, not FALLBACK_SEEDS
  });

  // Round 86 (T305): old expectation, the cell fell back after the first draw with `flinch-chance` (8 draws, the plain mean). New: the
  // flinch die is part of the class, the cell is a plan, and the classes with the flinch carry its chance.
  test('a flinch die is part of the plan: the classes with the flinch weigh its chance', () => {
    // The battle of pair-pattern.spec.ts: every acting body has its own speed (no tie).
    const root = doublesRoot(
      [pairSet('Fast', 'Aerodactyl', ['Extrasensory', 'Protect'], { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('Slow1', 'Snorlax', ['Body Slam', 'Protect']), pairSet('Slow2', 'Munchlax', ['Body Slam', 'Protect'])],
    );
    const cell = pairCellSample(root, 'move extrasensory 1, move softboiled', 'move bodyslam 1, move bodyslam 1', 1, createMatchupCache());
    expect(cell).toMatchObject({ kind: 'sample', via: 'plan', reason: null });
    if (cell.kind !== 'sample') return;
    const blend = cell.sample.blend!;
    expect(blend.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    const flinched = blend.classes.filter(cls => cls.key.split('|').some(part => part.startsWith('p1a:extrasensory>p2a=') && part.includes('+flinch')));
    expect(flinched.length).toBeGreaterThan(0);
    expect(flinched.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(0.1, 1);
  });

  test('three base seeds (the verify path): same value on repeat, still near the truth', { timeout: 60_000 }, () => {
    const root = anchorRoot();
    const once = pairCellSample(root, ...PLAYED, 3, createMatchupCache());
    const twice = pairCellSample(root, ...PLAYED, 3, createMatchupCache());
    expect(cellData(twice)).toEqual(cellData(once));
    if (once.kind !== 'sample') throw new Error('expected a sample');
    // r89 A5 gate: was 0.05 on the fixed seeds; the cell's own three base seeds read 0.082 away (a 3-draw class estimate).
    expect(Math.abs(once.sample.value - meanOver(root, ...PLAYED, seeds(256)))).toBeLessThan(0.1);
  });

  test('team preview at the root is not a pair cell', () => {
    const set = (name: string) => pairSet(name, 'Snorlax', ['Rest', 'Protect']);
    const battle = new Battle({ formatid: toID('gen9doublescustomgame'), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack([set('a'), set('b')]) }, p2: { name: 'B', team: Teams.pack([set('c'), set('d')]) } });
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
    expect(pairCellSample(root, 'team 12', 'team 12', 1, createMatchupCache())).toEqual({ kind: 'skip' });
  });
});
