import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  classifyChild, foldClassWeights, observeOrder, planCellEvents, koOddsForOptions,
  BOUNDARY_DRAW_BUDGET, PROBE_SEEDS, type CellEvent,
} from '../src/lib/eval/cell-blend';
import { reblendValue } from '../src/lib/eval/rank';
import { advancePositionWithLog, createRootPosition } from '../src/lib/eval/forward-model';
import { createLocalExecutor, searchPosition } from '../src/lib/eval/search';
import { searchOrchestrated } from '../src/lib/eval/orchestrator';

function makeSet(name: string, species: string, moves: string[], level = 50, item = '', ability = 'No Ability'): PokemonSet {
  return {
    name, species, item, ability, moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

const event = (side: 'p1' | 'p2', accuracy: number, killFraction: number, defenderIdent: string): CellEvent =>
  ({ side, moveId: 'testmove', defenderIdent, event: { accuracy, killFraction, pKill: accuracy * killFraction } });

test.describe('foldClassWeights', () => {
  test('the t23 shape: kill truncates the second actor', () => {
    // p1 Scald: 100% acc, 43% kill. p2 HJK: 90% acc, 100% kill. p1 first.
    const events = [event('p1', 1, 0.43, 'p2a: Medicham'), event('p2', 0.9, 1, 'p1a: Keldeo')];
    const weights = foldClassWeights(events, 'p1');
    expect(weights.get('hit-kill|none')).toBeCloseTo(0.43, 9);
    expect(weights.get('hit-nokill|hit-kill')).toBeCloseTo(0.57 * 0.9, 9);
    expect(weights.get('hit-nokill|miss')).toBeCloseTo(0.57 * 0.1, 9);
    expect([...weights.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  test('a single accuracy-only event splits hit/miss', () => {
    const weights = foldClassWeights([event('p1', 0.9, 0, 'p2a: Snorlax')], 'p1');
    expect(weights.get('miss')).toBeCloseTo(0.1, 9);
    expect(weights.get('hit-nokill')).toBeCloseTo(0.9, 9);
    expect(weights.has('hit-kill')).toBe(false);
  });
});

test.describe('classifyChild', () => {
  const events = [event('p1', 1, 0.43, 'p2a: Medicham'), event('p2', 0.9, 1, 'p1a: Keldeo')];
  test('kill before the second move classifies as truncation', () => {
    const key = classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|0 fnt',
      '|faint|p2a: Medicham',
    ], events);
    expect(key).toBe('hit-kill|none');
  });
  test('survive then hit-kill back', () => {
    const key = classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|20/100',
      '|move|p2a: Medicham|High Jump Kick|p1a: Keldeo',
      '|-damage|p1a: Keldeo|0 fnt',
      '|faint|p1a: Keldeo',
    ], events);
    expect(key).toBe('hit-nokill|hit-kill');
  });
  test('a miss classifies as miss', () => {
    const key = classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|20/100',
      '|move|p2a: Medicham|High Jump Kick|p1a: Keldeo',
      '|-miss|p2a: Medicham|p1a: Keldeo',
      '|-damage|p2a: Medicham|1/100',
    ], events);
    expect(key).toBe('hit-nokill|miss');
  });
  test('an unmodeled skip (cant) fails closed', () => {
    expect(classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|20/100',
      '|cant|p2a: Medicham|par',
    ], events)).toBeNull();
  });
});

test.describe('observeOrder', () => {
  const events = [event('p1', 1, 0.43, 'p2a: B'), event('p2', 0.9, 1, 'p1a: A')];
  test('a lone mover votes as first (kill truncation)', () => {
    expect(observeOrder([
      ['|move|p1a: A|Scald|p2a: B', '|faint|p2a: B'],
      ['|move|p1a: A|Scald|p2a: B', '|move|p2a: B|HJK|p1a: A'],
    ], events)).toBe('p1');
  });
  test('disagreeing orders fail closed', () => {
    expect(observeOrder([
      ['|move|p1a: A|Scald|p2a: B'],
      ['|move|p2a: B|HJK|p1a: A', '|move|p1a: A|Scald|p2a: B'],
    ], events)).toBeNull();
  });
});

test('reblendValue swaps the first leaf inside its class only', () => {
  const blend = {
    firstLeaf: 1,
    classes: [
      { weight: 0.43, leafSum: 2, count: 2, hasFirst: true },   // leaves 1, 1
      { weight: 0.57, leafSum: -1, count: 1, hasFirst: false },
    ],
  };
  // Deepened first child: 0.5 → class mean (0.5 + 1)/2 = 0.75.
  expect(reblendValue(blend, 0.5)).toBeCloseTo(0.43 * 0.75 + 0.57 * -1, 9);
});

test.describe('planCellEvents guards', () => {
  test('a paralyzed attacker fails closed', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    battle.sides[0].active[0]!.status = 'par' as never;
    expect(planCellEvents(battle, 'move hydropump', 'move tackle').kind).toBe('fail');
  });
  test('protect in the pair fails closed', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Snorlax', 'Snorlax', ['Protect'], 50)],
    );
    expect(planCellEvents(battle, 'move hydropump', 'move protect').kind).toBe('fail');
  });
  test('an 80% move yields a plan with one event', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
    );
    const plan = planCellEvents(battle, 'move hydropump', 'move tackle');
    expect(plan.kind).toBe('events');
    if (plan.kind === 'events') {
      expect(plan.events).toHaveLength(1);
      expect(plan.events[0].event.accuracy).toBeCloseTo(0.8, 5);
    }
  });
  test('all-deterministic pairs plan none', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
      [makeSet('Blissey', 'Blissey', ['Seismic Toss'], 100)],
    );
    expect(planCellEvents(battle, 'move seismictoss', 'move seismictoss').kind).toBe('none');
  });
});

test('advancePositionWithLog returns exactly this advance\'s lines', () => {
  const battle = makeBattle(
    [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
  );
  const root = createRootPosition(serialize(battle));
  const { log } = advancePositionWithLog(root, 'move seismictoss', 'move tackle', '1,2,3,4');
  expect(log.some(line => line.startsWith('|move|p1a:'))).toBe(true);
  expect(log.some(line => line.startsWith('|start'))).toBe(false); // pre-advance lines excluded
});

test('koOddsForOptions prices the stay-column headline', () => {
  const battle = makeBattle(
    [makeSet('Machamp', 'Machamp', ['Hydro Pump', 'Seismic Toss'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
  );
  const [pump, toss] = koOddsForOptions(battle, 'p1', ['move hydropump', 'move seismictoss']);
  expect(pump).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1 });
  expect(toss).toBeNull(); // fully deterministic — no event
});

// Keep the fixed-seed constants honest without pinning exact values elsewhere.
test('probe constants: eleven fixed seeds under a 16-draw budget', () => {
  expect(PROBE_SEEDS).toHaveLength(11);
  expect(PROBE_SEEDS[0]).toBe('21,22,23,24');
  expect(PROBE_SEEDS[10]).toBe('61,62,63,64');
  expect(BOUNDARY_DRAW_BUDGET).toBe(16);
});

test.describe('root-cell blend integration', () => {
  // Mutual-OHKO cell with exact ±1 leaves: p1's 80% Hydro Pump always kills
  // on a hit (+1); on a miss the surviving Pikachu's Tackle kills the 1-HP
  // attacker (−1). Analytic value = 0.8·1 + 0.2·(−1) = 0.6 exactly. The
  // fixed base seeds hit only 3/5 (frequency mean 0.2) — the assertion can
  // only pass when the analytic weights price the cell.
  const mutualRoot = () => {
    const battle = makeBattle(
      [makeSet('Deo', 'Deoxys-Speed', ['Hydro Pump', 'Seismic Toss'], 100)],
      [makeSet('Pika', 'Pikachu', ['Tackle', 'Growl'], 30)],
    );
    battle.sides[0].active[0]!.hp = 1;
    return serialize(battle);
  };
  // Full-HP variant: miss children stay alive (non-ended), exercising the
  // deepening re-blend path in both engines.
  const machampRoot = () => serialize(makeBattle(
    [makeSet('Machamp', 'Machamp', ['Hydro Pump', 'Seismic Toss'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30)],
  ));

  test('a boundary cell prices at analytic weights, not seed frequency', () => {
    const result = searchPosition(mutualRoot(), { depth: 1, samples: 5 });
    const matrix = result.matrix!;
    const i = matrix.p1Choices!.indexOf('move hydropump');
    const j = matrix.p2Choices!.indexOf('move tackle');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(matrix.values[i][j]).toBeCloseTo(0.6, 9);
    // Seismic Toss (deterministic KO) still prices as the certain line and
    // outranks the 80% gamble on floor.
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(toss.worstCase).toBeCloseTo(1, 9);
    expect(toss.worstCase).toBeGreaterThan(pump.worstCase);
  });

  test('samples:1 still blends at the root (the blend path draws what it needs)', () => {
    const result = searchPosition(mutualRoot(), { depth: 1, samples: 1 });
    const matrix = result.matrix!;
    const i = matrix.p1Choices!.indexOf('move hydropump');
    const j = matrix.p2Choices!.indexOf('move tackle');
    // One base draw hits (+1); the probe chase must find the missing miss
    // class and fold it at its analytic 0.2 — not the 1/3 of a 3-draw mean.
    expect(matrix.values[i][j]).toBeCloseTo(0.6, 9);
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(toss.worstCase).toBeGreaterThan(pump.worstCase);
  });

  test('orchestrated parity: the executor path produces the same blended matrix', async () => {
    const serialized = machampRoot();
    const sync = searchPosition(serialized, { depth: 2, samples: 3 });
    const orchestrated = await searchOrchestrated(createLocalExecutor(serialized), { depth: 2, samples: 3 });
    expect(orchestrated.score).toBeCloseTo(sync.score, 9);
    expect(orchestrated.matrix!.values).toEqual(sync.matrix!.values);
    expect(orchestrated.perSide.p1.map(r => [r.choice, r.ev])).toEqual(sync.perSide.p1.map(r => [r.choice, r.ev]));
    expect(orchestrated.koDiagnostics ?? null).toEqual(sync.koDiagnostics ?? null);
  });

  test('ranked options carry koOdds for real boundary events only', () => {
    const result = searchPosition(machampRoot(), { depth: 1, samples: 3 });
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1 });
    expect(toss.koOdds).toBeUndefined();
  });

  test('the orchestrated path attaches identical koOdds', async () => {
    const orchestrated = await searchOrchestrated(createLocalExecutor(machampRoot()), { depth: 1, samples: 3 });
    const pump = orchestrated.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1 });
  });
});
