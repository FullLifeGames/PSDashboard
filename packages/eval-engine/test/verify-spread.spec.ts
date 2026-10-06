import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { classifyChild, planCellEvents } from '../src/cell-blend';
import { createMatchupCache } from '../src/eval-function';
import { advancePosition, advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createLocalExecutor, subSearchDepth1 } from '../src/search';
import { countFainted, leafValue, SEARCH_SEEDS } from '../src/search/leaf';
import { sampleCell } from '../src/search/cell-sampler';
import { deepenVerifiedCell, stateKey, stateRuleFor, VERIFY_DEEPEN_COVER, VERIFY_PLAIN_DRAWS, VERIFY_PLAIN_SEEDS } from '../src/search/verify-cell';
import { VERIFY_SAMPLES } from '../src/verify-select';
import type { EvalCellValue, EvalSettings } from '../src/types';
import { doublesRoot, pairSet } from './pair-battles';

/**
 * Round 64 (T119): the verify step takes a class one ply deeper through one child per state its draws
 * leave. Since round 63 one child stood for a whole class, so what the log does not split decided the
 * class: VGC 2629703929 t8, the Sleep Powder hit class deepened through a sleep counter of 3 to −0.17
 * while a third of its draws wake next turn (0.96), class mean 0.21 over 18 Monte-Carlo draws (probe
 * docs/perf/probes/2026-10-06-r64/lanes/C). The state is what the simulator keeps on each Pokémon, HP
 * left out; the shares are the simulator's own draws.
 */

const SUB: EvalSettings = { depth: 1, samples: 1, tera: false };

function singlesRoot(p1: PokemonSet[], p2: PokemonSet[]): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

const L100 = { level: 100 };
const WALL = () => pairSet('Wall', 'Snorlax', ['Curse', 'Rest'], L100);
const BACK = () => pairSet('Back', 'Chansey', ['Soft-Boiled'], L100);
/** Hypnosis (60 %) from the faster side: the slept Snorlax cannot act this turn, its counter reads 1, 2 or 3. */
const hypnosisRoot = () => singlesRoot([pairSet('Caster', 'Gengar', ['Hypnosis', 'Shadow Ball'], L100), BACK()], [WALL(), BACK()]);
/** Spore (sure hit): a cell the sampler draws once, its counter decided by the first seed. */
const sporeRoot = () => singlesRoot([pairSet('Caster', 'Breloom', ['Spore', 'Mach Punch'], L100), BACK()], [WALL(), BACK()]);
/** Steam Eruption (95 %, 30 % burn) into Snorlax: a miss class and a hit class whose draws burn or not. */
const steamRoot = () => singlesRoot([pairSet('Caster', 'Volcanion', ['Steam Eruption', 'Flamethrower'], L100), BACK()], [WALL(), BACK()]);

/** Two slow walls at different speeds (a speed tie sends a doubles cell to the plain fallback). */
const DOUBLES_P2 = () => [
  pairSet('A', 'Snorlax', ['Curse', 'Rest']),
  pairSet('B', 'Snorlax', ['Curse', 'Rest'], { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 252 } }),
];
const doublesSleepRoot = (move: 'Sleep Powder' | 'Spore') => doublesRoot(
  [pairSet('Caster', move === 'Spore' ? 'Breloom' : 'Venusaur', [move, 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
  DOUBLES_P2(),
);
const doublesSteamRoot = () => doublesRoot(
  [pairSet('Caster', 'Volcanion', ['Steam Eruption', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
  DOUBLES_P2(),
);

/** The target's sleep counter (0 when awake) and whether it burns, read off a child. */
const target = (child: SimPosition) => positionBattle(child).sides[1].active[0]!;
const wakesNextTurn = (child: SimPosition) => (target(child).status === 'slp' && target(child).statusState.time === 1 ? 1 : 0);
const burned = (child: SimPosition) => (target(child).status === 'brn' ? 1 : 0);

/** The verify step's deepening of one cell with a stand-in for the sub-search. */
function deepenWith(root: SimPosition, p1: string, p2: string, deeper: (child: SimPosition) => number): EvalCellValue {
  const sample = sampleCell(root, countFainted(positionBattle(root)), p1, p2, VERIFY_SAMPLES, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
  const value: EvalCellValue = { i: 0, j: 0, value: sample.value, ended: sample.ended, ...(sample.blend ? { blend: structuredClone(sample.blend) } : {}) };
  const cover = VERIFY_DEEPEN_COVER[positionBattle(root).gameType === 'doubles' ? 'doubles' : 'singles'];
  deepenVerifiedCell(value, sample, deeper, cover);
  return value;
}

/** The natural verify draws of the game type's pool (singles sixteen fixed seeds, doubles eight) that pass `keep`. */
const naturalDraws = (root: SimPosition, p1: string, p2: string, keep: (log: string[]) => boolean = () => true) =>
  VERIFY_PLAIN_SEEDS.slice(0, stateRuleFor(root).pool).map(seed => advancePositionWithLog(root, p1, p2, seed)).filter(draw => keep(draw.log));
const shareOf = (children: SimPosition[], f: (child: SimPosition) => number) =>
  children.reduce((sum, child) => sum + f(child), 0) / children.length;

describe('the state a draw leaves (round 64, T119)', () => {
  test('the sleep counter, the burn and the stat stages tell draws apart; HP does not', () => {
    const slept = naturalDraws(hypnosisRoot(), 'move hypnosis', 'move curse', log => !log.some(line => line.startsWith('|-miss|')));
    const counters = new Set(slept.map(draw => target(draw.child).statusState.time));
    expect(counters.size).toBeGreaterThan(1);
    const keys = new Map(slept.map(draw => [target(draw.child).statusState.time, stateKey(draw.child)]));
    expect(new Set(keys.values()).size).toBe(counters.size);
    const missed = naturalDraws(hypnosisRoot(), 'move hypnosis', 'move curse', log => log.some(line => line.startsWith('|-miss|')));
    expect(missed.length).toBeGreaterThan(0);
    expect([...keys.values()]).not.toContain(stateKey(missed[0].child)); // Curse's stages
    const hits = naturalDraws(steamRoot(), 'move steameruption', 'move curse', log => !log.some(line => line.startsWith('|-miss|')));
    const clean = hits.filter(draw => !burned(draw.child));
    const hp = new Set(clean.map(draw => target(draw.child).hp));
    expect(hp.size).toBeGreaterThan(1);
    expect(new Set(clean.map(draw => stateKey(draw.child))).size).toBe(1);
    const scorched = hits.find(draw => burned(draw.child))!;
    expect(stateKey(scorched.child)).not.toBe(stateKey(clean[0].child));
  });
});

describe('hidden lengths go one ply deeper one by one (round 64, T119)', () => {
  test('singles: the hit class of Hypnosis goes deeper through every sleep counter, mixed by its share', () => {
    const root = hypnosisRoot();
    const plan = planCellEvents(positionBattle(root), 'move hypnosis', 'move curse');
    expect(plan.kind).toBe('events');
    if (plan.kind !== 'events') return;
    const value = deepenWith(root, 'move hypnosis', 'move curse', wakesNextTurn);
    const hit = value.blend!.classes.find(cls => cls.key.startsWith('hit'))!;
    // The stand-in reads 1 only where the counter says "wakes next turn": the class's depth is that share of its draws.
    const inClass = naturalDraws(root, 'move hypnosis', 'move curse', log => classifyChild(log, plan.events) === hit.key);
    const expected = shareOf(inClass.map(draw => draw.child), wakesNextTurn);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
    expect(hit.deepened).toBeCloseTo(expected, 12);
  });

  test('doubles: the heaviest class (Sleep Powder hits) goes deeper through every sleep counter it drew', () => {
    const root = doublesSleepRoot('Sleep Powder');
    const [p1, p2] = ['move sleeppowder 1, move softboiled', 'move curse, move curse'];
    const value = deepenWith(root, p1, p2, wakesNextTurn);
    const hit = value.blend!.classes.find(cls => cls.key.endsWith('=hit'))!;
    const hits = naturalDraws(root, p1, p2, log => !log.some(line => line.startsWith('|-miss|')));
    const expected = shareOf(hits.map(draw => draw.child), wakesNextTurn);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
    expect(hit.deepened).toBeCloseTo(expected, 12);
  });

  test('singles and doubles: a sure-hit Spore (one draw before) draws the pool and goes deeper per counter', () => {
    for (const [root, p1, p2] of [
      [sporeRoot(), 'move spore', 'move curse'],
      [doublesSleepRoot('Spore'), 'move spore 1, move softboiled', 'move curse, move curse'],
    ] as const) {
      const value = deepenWith(root, p1, p2, wakesNextTurn);
      const expected = shareOf(naturalDraws(root, p1, p2).map(draw => draw.child), wakesNextTurn);
      expect(expected, p1).toBeGreaterThan(0);
      expect(expected, p1).toBeLessThan(1);
      expect(value.deepened, p1).toBeCloseTo(expected, 12);
    }
  });
});

describe('secondary effects inside a class (round 64, T119)', () => {
  test('singles: the hit class of Steam Eruption goes deeper burned and unburned, mixed by its share of the class draws', () => {
    const root = steamRoot();
    const plan = planCellEvents(positionBattle(root), 'move steameruption', 'move curse');
    expect(plan.kind).toBe('events');
    if (plan.kind !== 'events') return;
    const value = deepenWith(root, 'move steameruption', 'move curse', burned);
    const hit = value.blend!.classes.find(cls => cls.key === 'hit-nokill')!;
    const inClass = naturalDraws(root, 'move steameruption', 'move curse', log => classifyChild(log, plan.events) === 'hit-nokill');
    const expected = shareOf(inClass.map(draw => draw.child), burned);
    expect(expected).toBeGreaterThan(0);
    expect(hit.deepened).toBeCloseTo(expected, 12);
  });

  test("doubles reads only the counts: a burn inside the heaviest class keeps the class's first draw", () => {
    // Doubles splits only the counts the simulator keeps (the +10 % tree-time bound); a burn the leaf reads
    // goes deeper through the class's own first draw, as before.
    const root = doublesSteamRoot();
    const [p1, p2] = ['move steameruption 1, move softboiled', 'move curse, move curse'];
    const value = deepenWith(root, p1, p2, burned);
    const heaviest = [...value.blend!.classes].sort((a, b) => b.weight - a.weight)[0];
    expect(heaviest.key).toContain('hit');
    const hits = naturalDraws(root, p1, p2, log => !log.some(line => line.startsWith('|-miss|')));
    expect(shareOf(hits.map(draw => draw.child), burned)).toBeGreaterThan(0);
    const sample = sampleCell(root, countFainted(positionBattle(root)), p1, p2, VERIFY_SAMPLES, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
    expect(sample.classGroups?.has(heaviest.key) ?? false).toBe(false);
    expect(heaviest.deepened).toBe(burned(sample.classChildren!.get(heaviest.key)!));
  });
});

describe('a cell whose draws leave one state prices as before (round 64, T119)', () => {
  test('singles and doubles: Curse against Curse, value and depth from the first draw', async () => {
    for (const [root, p1, p2] of [
      [singlesRoot([WALL(), BACK()], [WALL(), BACK()]), 'move curse', 'move curse'],
      [doublesRoot([pairSet('A', 'Snorlax', ['Curse', 'Rest']), pairSet('B', 'Blissey', ['Soft-Boiled', 'Protect'])], DOUBLES_P2()), 'move curse, move softboiled', 'move curse, move curse'],
    ] as const) {
      const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: p1, p2Choice: p2, samples: VERIFY_SAMPLES, deepen: SUB }]);
      const first = advancePosition(root, p1, p2, SEARCH_SEEDS[0]);
      expect(value.value, p1).toBeCloseTo(leafValue(positionBattle(first), createMatchupCache()), 12);
      expect(value.deepened, p1).toBeCloseTo(subSearchDepth1(first.serialized, SUB, createMatchupCache()).score, 12);
    }
  });
});
