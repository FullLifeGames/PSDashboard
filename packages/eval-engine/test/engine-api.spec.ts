import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENGINE_PROTOCOL, buildEngineRequest, engineOptions, engineResponseToResult, validateEngineResponse,
  type EngineRequest, type EngineResponse,
} from '../src/engine-api/index.ts';
import { rankFromMatrix, toResult } from '../src/ranking/order.ts';
import { searchOptions, expandPivotPairs } from '../src/search/options.ts';
import { createRootPosition } from '../src/forward/position.ts';

const position = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf8')) as { serialized: string; turn: number };

/** The root options the engine's own matrix uses. */
function rootOptions(serialized: string) {
  const root = createRootPosition(serialized);
  return {
    p1: expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera: true })),
    p2: expandPivotPairs(root, 'p2', searchOptions(root, 'p2', { tera: true })),
  };
}

function request(overrides: Partial<EngineRequest> = {}): EngineRequest {
  return {
    protocol: ENGINE_PROTOCOL, format: 'gen9ou', simFormat: 'gen9ou', gen: 9, gameType: 'singles', turn: 12, log: [], requests: { p1: null, p2: null },
    options: {
      p1: engineOptions([{ choice: 'move closecombat', label: 'Close Combat' }, { choice: 'switch 5', label: '→ Mandibuzz' }]),
      p2: engineOptions([{ choice: 'move shadowball', label: 'Shadow Ball' }, { choice: 'switch 6', label: '→ Weavile' }]),
    },
    state: '{}', budgetMs: 5000, ...overrides,
  };
}

const answer = (overrides: Partial<EngineResponse> = {}): EngineResponse => ({
  protocol: ENGINE_PROTOCOL, score: 0.17,
  values: { p1: { 'move closecombat': 0.01, 'switch 5': 0.17 }, p2: { 'move shadowball': -0.17, 'switch 6': -0.26 } },
  ...overrides,
});

describe('the engine protocol (round 77, user gate 28.10.2026: "1a 2a 3a 4a 5a 6a")', () => {
  test('an option names the dashboard id, the label, and the command a Showdown client sends', () => {
    expect(engineOptions([
      { choice: 'move closecombat', label: 'Close Combat' },
      { choice: 'switch 5', label: '→ Mandibuzz' },
      { choice: 'move uturn > switch 3', label: 'U-turn → Kyurem' },
      { choice: 'move 1 1 terastallize, move 2 -1', label: 'Tera + Heat Wave → Rillaboom + Protect' },
    ])).toEqual([
      { id: 'move closecombat', label: 'Close Combat', command: 'move closecombat' },
      { id: 'switch 5', label: '→ Mandibuzz', command: 'switch 5' },
      { id: 'move uturn > switch 3', label: 'U-turn → Kyurem', command: 'move uturn', then: 'switch 3' },
      { id: 'move 1 1 terastallize, move 2 -1', label: 'Tera + Heat Wave → Rillaboom + Protect', command: 'move 1 1 terastallize, move 2 -1' },
    ]);
  });

  test('a request carries what a Showdown bot reads and what the simulator holds, in singles, doubles and VGC', () => {
    for (const [name, gameType] of [['gen9ou-2658658993-t2', 'singles'], ['gen9doublesou-2663093831-t12', 'doubles'], ['gen9vgc2026regi-2629703929-t13', 'doubles']] as const) {
      const fixture = position(name);
      const options = rootOptions(fixture.serialized);
      const built = buildEngineRequest(fixture.serialized, options, 4000);
      expect(built.protocol).toBe(ENGINE_PROTOCOL);
      expect(built.gameType).toBe(gameType);
      expect(built.gen).toBe(9);
      expect(built.turn).toBe(fixture.turn);
      expect(built.state).toBe(fixture.serialized);
      expect(built.budgetMs).toBe(4000);
      expect(built.options.p1.map(option => option.id)).toEqual(options.p1.map(option => option.choice));
      // The spectator log: the public lines up to the turn, no |split| secrets.
      expect(built.log).toContain(`|turn|${fixture.turn}`);
      expect(built.log.some(line => line.startsWith('|split|'))).toBe(false);
      // Each side's request as the simulator would send it.
      expect((built.requests.p1 as { side?: { id?: string } } | null)?.side?.id).toBe('p1');
      expect((built.requests.p2 as { side?: { id?: string } } | null)?.side?.id).toBe('p2');
    }
  });

  test('a response must value every option of both sides on the [-1, 1] scale, and a matrix must match the options', () => {
    expect(validateEngineResponse(request(), answer())).toEqual({ ok: true, response: answer() });
    const errors = (value: unknown) => {
      const checked = validateEngineResponse(request(), value);
      return checked.ok ? [] : checked.errors;
    };
    expect(errors({ ...answer(), protocol: 'other/2' })).toEqual([`protocol must be "${ENGINE_PROTOCOL}"`]);
    expect(errors(answer({ score: 1.5 }))).toEqual(['score must be a number from -1 to 1']);
    expect(errors(answer({ values: { p1: { 'move closecombat': 0.01 }, p2: answer().values.p2 } })))
      .toEqual(['values.p1 lacks option "switch 5"']);
    expect(errors(answer({ values: { p1: { ...answer().values.p1, 'move earthquake': 0 }, p2: answer().values.p2 } })))
      .toEqual(['values.p1 names "move earthquake", which is no option']);
    expect(errors(answer({ values: { p1: { 'move closecombat': Number.NaN, 'switch 5': 0 }, p2: answer().values.p2 } })))
      .toEqual(['values.p1["move closecombat"] must be a number from -1 to 1']);
    expect(errors(answer({ matrix: { p1: ['move closecombat', 'switch 5'], p2: ['move shadowball'], values: [[0], [0]] } })))
      .toEqual(['matrix.p2 must list every p2 option once']);
    expect(errors(answer({ matrix: { p1: ['move closecombat', 'switch 5'], p2: ['move shadowball', 'switch 6'], values: [[0, 0]] } })))
      .toEqual(['matrix.values must have one row per matrix.p1 entry and one column per matrix.p2 entry, each from -1 to 1']);
    expect(errors('not json')).toEqual(['the answer must be a JSON object']);
  });

  test('without a matrix every value is its own floor and expectation; the score is the engine\'s', () => {
    const result = engineResponseToResult(request(), answer());
    expect(result.score).toBe(0.17);
    expect(result.interval).toBe(0);
    expect(result.depthCompleted).toBe(1);
    expect(result.matrix).toBeUndefined();
    expect(result.perSide.p1).toEqual([
      { choice: 'switch 5', label: '→ Mandibuzz', worstCase: 0.17, expected: 0.17, ev: 0.17, punishedBy: null },
      { choice: 'move closecombat', label: 'Close Combat', worstCase: 0.01, expected: 0.01, ev: 0.01, punishedBy: null },
    ]);
    expect(result.perSide.p2[0]).toMatchObject({ choice: 'move shadowball', ev: -0.17 });
  });

  test('with a matrix the dashboard solves the game as for its own engine: floors, punishers and mixes', () => {
    const matrix = { p1: ['move closecombat', 'switch 5'], p2: ['move shadowball', 'switch 6'], values: [[0.01, 0.62], [0.17, 0.33]] };
    const result = engineResponseToResult(request(), answer({ matrix }));
    const own = toResult(rankFromMatrix({
      p1Options: [{ choice: 'move closecombat', label: 'Close Combat' }, { choice: 'switch 5', label: '→ Mandibuzz' }],
      p2Options: [{ choice: 'move shadowball', label: 'Shadow Ball' }, { choice: 'switch 6', label: '→ Weavile' }],
      values: matrix.values,
      ended: matrix.values.map(row => row.map(() => false)),
    }, 0.17), 1);
    expect(result).toEqual(own);
    expect(result.perSide.p1.find(entry => entry.choice === 'move closecombat')?.punishedBy).toBe('Shadow Ball');
    expect(result.matrix?.mixes.p1.length).toBe(2);
  });
});
