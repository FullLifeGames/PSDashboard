import { readFileSync, writeFileSync } from 'node:fs';
import { Battle, PRNG, Teams, toID, type PokemonSet, State } from '@pkmn/sim';
import { describe, expect, test, afterEach, beforeEach, onTestFinished } from 'vitest';
import { searchOrchestrated, type SearchExecutor } from '../src/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/search';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import {
  autoTurnSettings,
  configureSearchBudget,
  searchBudget,
  SEARCH_BUDGET_DEFAULT,
  parseSearchBudget,
  searchBudgetTag,
} from '../src/search/budget';
import {
  deserializeBattleExact,
  advancePosition,
  advancePositionWithLog,
  createRootPosition,
  legalChoices,
  type SimPosition,
} from '../src/forward-model';
import { serializeLiveBattle } from '../src/serialize';
import { loadSimModsFor } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, EvalSettings } from '../src/types';
import { evaluatePosition } from '../src/eval-function';
import { createMatchupCache } from '../src/score/threat';
import { resetHitMemo } from '../src/score/contact';
import { resetResidualMemo } from '../src/score/residuals';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mctsTreeSearch } from '../src/mcts';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import doublesTeams from './fixtures/doubles-identity-fixture';
import { treeSeed } from '../src/search/leaf';
import { SEARCH_SEEDS } from './seed-streams';
import { AUTO_MCTS_FAINTED_FRACTION } from '../src/types';

/**
 * Round 89 (SB-4, issue #197): a forced replacement under the matrix is judged by the turn that follows it. The pivot request or
 * the knock-out is the root; its cells are the switch-ins (one column, "waiting", or the other side's own replacements), and each
 * cell's child is the board on arrival. The search used to price that board by the static alone, so two bodies that look alike on
 * arrival tied, and a body that loses its race the next turn could still lead (the user's game: Glimmora after U-turn). Now every
 * cell holds the engine's own search of its child, one turn, the root's draws: the replacement's value is the solved value of the
 * turn that follows.
 *
 * Rows: the user's game (Great Tusk), two corpus replacements the static read wrong (653785 turn 10: Lopunny-Mega where the player
 * sent Weavile; 655336 turn 5, p2: Clefable where the reference reads Lopunny), a doubles replacement under an explicit matrix
 * (VGC 2630685175 turn 2, one slot, and turn 4, two slots), and the guards: a root with no forced request is unchanged, the tree
 * keeps its own forced node, the sync and the orchestrated search agree, and a stop leaves the depth-1 result.
 * The reference of every row is computed here: each switch-in played on a copy, then the search of that board with the same settings.
 */

interface Fixture { settings: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; serialized: string }
const read = (name: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Fixture;
const gholdengo = JSON.parse(readFileSync(new URL('./fixtures/sb-gholdengo.json', import.meta.url), 'utf-8')) as
  Fixture & { turn2: string; forced: string };

const settingsOf = (scene: Fixture, samples: 1 | 3 | 5, depth: 1 | 2 | 3 = 1): EvalSettings => ({
  depth, samples, mode: 'matrix', tera: scene.settings.tera, sleepClause: scene.settings.sleepClause, ruleset: scene.settings.ruleset, prove: false,
});
const search = (scene: Fixture, serialized: string, settings: EvalSettings): Promise<EvalResult> =>
  searchOrchestrated(createLocalExecutor(serialized, scene.settings.ruleset), settings);

/** The side that chooses at the root: the one whose list is not the waiting sentinel. */
const choosingSide = (result: EvalResult): 'p1' | 'p2' => (result.perSide.p1[0]?.choice === 'wait' ? 'p2' : 'p1');

/** The reference: every row's choice played on a copy, then the search of the board it makes (the app's own turn search, depth 1). */
async function perBody(scene: Fixture, serialized: string, settings: EvalSettings, side: 'p1' | 'p2', choices: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const choice of choices) {
    const copy = deserializeBattleExact(serialized);
    copy.prng = new PRNG([1, 2, 3, 4]);
    if (!copy.choose(side, choice)) throw new Error(`${side} ${choice} rejected`);
    const sub = await search(scene, serializeLiveBattle(copy), settings);
    out.set(choice, side === 'p1' ? sub.score : -sub.score);
  }
  return out;
}

const argmax = (values: Map<string, number>): string => [...values].sort((a, b) => b[1] - a[1])[0][0];

/** What a row has to hold: the first row is the best body by the turn after it, and every row carries that turn's value. */
async function expectTurnValues(scene: Fixture, serialized: string, settings: EvalSettings): Promise<{ result: EvalResult; side: 'p1' | 'p2'; reference: Map<string, number> }> {
  const result = await search(scene, serialized, settings);
  const side = choosingSide(result);
  const rows = result.perSide[side];
  const reference = await perBody(scene, serialized, settings, side, rows.map(row => row.choice));
  expect(rows[0].choice).toBe(argmax(reference));
  for (const row of rows) expect(row.ev).toBeCloseTo(reference.get(row.choice)!, 6);
  return { result, side, reference };
}

describe('a forced replacement under the matrix is judged by the turn after it (singles, d1 s3)', () => {
  test('the shared game: after U-turn the first row is Great Tusk, the best body by the turn after it', async () => {
    await loadSimModsFor(gholdengo.forced);
    const { result, side } = await expectTurnValues(gholdengo, gholdengo.forced, settingsOf(gholdengo, 3));
    expect(side).toBe('p1');
    expect(result.perSide.p1[0].label).toBe('→ Great Tusk');
    expect(result.depthCompleted).toBe(2);
  }, 240_000);

  test('653785 turn 10: Weavile, the body the player sent, not Lopunny-Mega', async () => {
    const scene = read('forced-root/singles-653785-t10.json');
    await loadSimModsFor(scene.serialized);
    const { result, side } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 3));
    expect(side).toBe('p1');
    expect(result.perSide.p1[0].label).toBe('→ Weavile');
  }, 600_000);

  test('655336 turn 5 (p2): Lopunny by the turn after it, not Clefable', async () => {
    const scene = read('forced-root/singles-655336-t5.json');
    await loadSimModsFor(scene.serialized);
    const { result, side } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 3));
    expect(side).toBe('p2');
    expect(result.perSide.p2[0].label).toBe('→ Lopunny');
  }, 600_000);
});

describe('doubles under an explicit matrix: the same rule on every assignment', () => {
  test('VGC 2630685175 turn 2 (p1, one slot): the first row is the assignment the next turn rates best', async () => {
    const scene = read('forced-root/vgc-2630685175-t2.json');
    await loadSimModsFor(scene.serialized);
    const { result, side } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 1));
    expect(side).toBe('p1');
    expect(result.depthCompleted).toBe(2);
  }, 600_000);

  test('VGC 2630685175 turn 4 (p2, both slots): every assignment is searched', async () => {
    const scene = read('forced-root/vgc-2630685175-t4.json');
    await loadSimModsFor(scene.serialized);
    const { result, side, reference } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 1));
    expect(side).toBe('p2');
    expect(reference.size).toBe(result.perSide.p2.length);
  }, 600_000);
});

/** An executor that counts the sub-searches that ask for a whole turn, and runs `onTurn` when one starts. */
function counting(base: SearchExecutor, onTurn?: () => void): { executor: SearchExecutor; turns: () => number } {
  let turns = 0;
  return {
    turns: () => turns,
    executor: {
      ...base,
      subSearch: job => {
        if ((job as { turn?: boolean }).turn) { turns += 1; onTurn?.(); }
        return base.subSearch(job);
      },
    },
  };
}

const rowsOf = (result: EvalResult, side: 'p1' | 'p2') => result.perSide[side].map(row => [row.label, row.ev]);

/** The guards run on a small game of the simulator's own: Rillaboom's Memento faints it, and P1 chooses among Pikachu, Eevee and Snorlax. */
const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
});
function smallGame(memento: boolean): string {
  const battle = new Battle({
    formatid: toID('gen9customgame') as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([mon('Rillaboom', ['Memento', 'Splash']), mon('Pikachu', ['Thunderbolt']), mon('Eevee', ['Tackle']), mon('Snorlax', ['Body Slam'])]) },
    p2: { name: 'Beta', team: Teams.pack([mon('Corviknight', ['Splash', 'Brave Bird']), mon('Garchomp', ['Earthquake'])]) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  if (memento) {
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
  }
  return serializeLiveBattle(battle);
}
const small = { settings: { tera: false, ruleset: 'standard' as StaticRuleset, sleepClause: false }, serialized: smallGame(true) };

describe('guards', () => {
  test('a root with no forced request keeps its matrix: no turn search, depth 1', async () => {
    const open = smallGame(false);
    const { executor, turns } = counting(createLocalExecutor(open, small.settings.ruleset));
    const result = await searchOrchestrated(executor, settingsOf(small, 3));
    expect(turns()).toBe(0);
    expect(result.depthCompleted).toBe(1);
  }, 120_000);

  test('the small game stands at a forced request and the turn searches match the reference', async () => {
    const { result, side } = await expectTurnValues(small, small.serialized, settingsOf(small, 3));
    expect(side).toBe('p1');
    expect(result.depthCompleted).toBe(2);
    expect(result.perSide.p1).toHaveLength(3);
  }, 120_000);

  test('the sync search and the orchestrated search agree at a forced root', async () => {
    const settings = settingsOf(small, 3);
    const sync = searchPosition(small.serialized, settings);
    const orchestrated = await search(small, small.serialized, settings);
    expect(sync.depthCompleted).toBe(orchestrated.depthCompleted);
    expect(sync.score).toBeCloseTo(orchestrated.score, 9);
    expect(rowsOf(sync, 'p1')).toEqual(rowsOf(orchestrated, 'p1'));
  }, 120_000);

  test.each([
    ['singles (the small game)', 'small'],
    ['doubles (VGC 2630685175 turn 2)', 'vgc'],
  ])('the tree keeps its own forced node, %s: no turn search', async (_name, which) => {
    const scene = which === 'vgc' ? read('forced-root/vgc-2630685175-t2.json') : small;
    await loadSimModsFor(scene.serialized);
    const previous = searchBudget();
    configureSearchBudget({ ...previous, trees: 2, iterations: 50 });
    try {
      const base = createLocalTreeExecutor(scene.serialized, scene.settings.ruleset);
      const counted = counting(base);
      await searchTreesOrchestrated({ ...base, subSearch: counted.executor.subSearch }, { ...settingsOf(scene, 1), mode: 'mcts' });
      expect(counted.turns()).toBe(0);
    } finally {
      configureSearchBudget(previous === SEARCH_BUDGET_DEFAULT ? null : previous);
    }
  }, 240_000);

  test('Auto keeps the tree in doubles from the first turn and the matrix in early singles', () => {
    expect(autoTurnSettings(0.12, true).mode).toBe('mcts');
    expect(autoTurnSettings(0.08, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
  });

  test('a stop before the turn searches leaves the depth-1 result, sync and orchestrated', async () => {
    const settings = settingsOf(small, 3);
    const { executor, turns } = counting(createLocalExecutor(small.serialized, small.settings.ruleset));
    const stopped = await searchOrchestrated(executor, settings, { shouldStop: () => true });
    const sync = searchPosition(small.serialized, settings, { shouldStop: () => true });
    expect(turns()).toBe(0);
    expect(stopped.depthCompleted).toBe(1);
    expect(sync.depthCompleted).toBe(1);
    expect(rowsOf(sync, 'p1')).toEqual(rowsOf(stopped, 'p1'));
  }, 120_000);

  test('a stop during the turn searches discards them: no row mixes a turn value with an arrival value', async () => {
    const settings = settingsOf(small, 3);
    const baseline = await searchOrchestrated(createLocalExecutor(small.serialized, small.settings.ruleset), settings, { shouldStop: () => true });
    let stop = false;
    const { executor } = counting(createLocalExecutor(small.serialized, small.settings.ruleset), () => { stop = true; });
    const orchestrated = await searchOrchestrated(executor, settings, { shouldStop: () => stop });
    expect(orchestrated.depthCompleted).toBe(1);
    expect(rowsOf(orchestrated, 'p1')).toEqual(rowsOf(baseline, 'p1'));
    let flipped = false;
    const sync = searchPosition(small.serialized, settings, { shouldStop: () => flipped, onProgress: progress => { if (progress.depth === 2) flipped = true; } });
    expect(sync.depthCompleted).toBe(1);
    expect(rowsOf(sync, 'p1')).toEqual(rowsOf(baseline, 'p1'));
  }, 240_000);

  test('an explicit depth 2 reads the turn after the replacement once: rows equal the depth-1 forced rows', async () => {
    const d1 = await search(small, small.serialized, settingsOf(small, 3, 1));
    const d2 = await search(small, small.serialized, settingsOf(small, 3, 2));
    expect(d2.depthCompleted).toBe(2);
    expect(rowsOf(d2, 'p1')).toEqual(rowsOf(d1, 'p1'));
  }, 240_000);
});

describe('board-key-history', () => {
  const MOVE = 'woodhammer';

  function board(format: string, substituteHp: number): Battle {
    const battle = battleOf(
      format,
      [set('Rillaboom', [MOVE, 'swordsdance'], { ability: 'Grassy Surge' }), set('Clefable', ['splash'])],
      [set('Dragonite', ['dragonclaw', 'splash']), set('Snorlax', ['splash'])],
    );
    const attacker = battle.sides[0].active[0]!;
    attacker.boosts.atk = 2;
    attacker.hp = Math.floor(attacker.maxhp * 0.45);
    const target = battle.sides[1].active[0]!;
    target.hp = Math.floor(target.maxhp * 0.5);
    target.addVolatile('substitute');
    (target.volatiles.substitute as { hp: number }).hp = substituteHp;
    return battle;
  }

  const CASES: { name: string; format: string; ruleset: StaticRuleset }[] = [
    { name: 'singles', format: 'gen9customgame', ruleset: 'standard' },
    { name: 'VGC doubles', format: 'gen9doublescustomgame', ruleset: 'vgc' },
  ];

  const clear = (): void => { resetHitMemo(); resetResidualMemo(); };

  beforeEach(clear);
  afterEach(() => configureSearchBudget(null));

  describe.each(CASES)('a board reads the same whichever boards came before it ($name)', ({ format, ruleset }) => {
    const evaluate = (substituteHp: number): number => evaluatePosition(board(format, substituteHp), createMatchupCache(ruleset));
    const search = (substituteHp: number): string => {
      const battle = board(format, substituteHp);
      const result = searchPosition(JSON.stringify(State.serializeBattle(battle)), { depth: 1, samples: 1, tera: false, mode: 'matrix', ruleset });
      return JSON.stringify([result.score, result.perSide.p1.map(row => [row.choice, row.ev]), result.perSide.p2.map(row => [row.choice, row.ev])]);
    };
    const ORDERS: { name: string; boards: (200 | 10)[]; clearBefore?: number }[] = [
      { name: 'A B A', boards: [200, 10, 200] },
      { name: 'B A B', boards: [10, 200, 10] },
      { name: 'A B A with a clear between B and A', boards: [200, 10, 200], clearBefore: 2 },
    ];

    test.each([['the static evaluation', evaluate], ['one search per board', search]] as const)('%s: every reading of a board equals its reading alone', (_kind, read) => {
      if (read === search) configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 40 });
      const alone = { 200: (clear(), read(200)), 10: (clear(), read(10)) };
      // Teeth: the Substitute's HP moves the reading.
      expect(JSON.stringify(alone[200])).not.toBe(JSON.stringify(alone[10]));
      const wrong: string[] = [];
      for (const order of ORDERS) {
        clear();
        order.boards.forEach((hp, step) => {
          if (step === order.clearBefore) clear();
          if (JSON.stringify(read(hp)) !== JSON.stringify(alone[hp])) wrong.push(`${order.name}: step ${step + 1} (${hp === 200 ? 'A' : 'B'})`);
        });
      }
      expect(wrong).toEqual([]);
    });
  });
});

const RECORD = process.env.PERF_IDENTITY_RECORD === '1';
const FIXTURE = fileURLToPath(new URL('./fixtures/fork-identity.json', import.meta.url));
const SEEDS = ['1,2,3,4', '5,6,7,8'];
/** The keys the history stripping changes by design: the log family and the sim's cursors into it. */
const HISTORY_KEYS = ['log', 'inputLog', 'messageLog', 'sentLogPos', 'lastMoveLine', 'sentRequests', 'sentEnd'];

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(formatid: string, p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

function makeSixVsSix(): Battle {
  return makeBattle('gen9customgame',
    [
      makeSet('Machamp', 'Machamp', ['Close Combat', 'Knock Off', 'Bullet Punch', 'Protect']),
      makeSet('Snorlax', 'Snorlax', ['Body Slam', 'Earthquake', 'Rest', 'Protect']),
      makeSet('Dragapult', 'Dragapult', ['Dragon Darts', 'U-turn', 'Will-O-Wisp', 'Protect']),
      makeSet('Kyurem', 'Kyurem', ['Draco Meteor', 'Ice Beam', 'Earth Power', 'Protect']),
      makeSet('Corviknight', 'Corviknight', ['Brave Bird', 'Body Press', 'Roost', 'Protect']),
      makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Soft-Boiled', 'Stealth Rock', 'Protect']),
    ],
    [
      makeSet('Garchomp', 'Garchomp', ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Protect']),
      makeSet('Rotom-Wash', 'Rotom-Wash', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Protect']),
      makeSet('Ferrothorn', 'Ferrothorn', ['Power Whip', 'Gyro Ball', 'Spikes', 'Protect']),
      makeSet('Volcarona', 'Volcarona', ['Flamethrower', 'Bug Buzz', 'Quiver Dance', 'Protect']),
      makeSet('Toxapex', 'Toxapex', ['Surf', 'Toxic', 'Recover', 'Protect']),
      makeSet('Tyranitar', 'Tyranitar', ['Stone Edge', 'Crunch', 'Earthquake', 'Protect']),
    ],
  );
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

/** Plays `turns` turns of each side's first legal choice: a position with history behind it. */
function withHistory(root: SimPosition, turns: number): SimPosition {
  let position = root;
  for (let turn = 0; turn < turns; turn++) {
    position = advancePosition(position, legalChoices(position, 'p1')[0].choice, legalChoices(position, 'p2')[0].choice, '1,2,3,4');
  }
  return position;
}

function stripHistory(serialized: string): string {
  const state = JSON.parse(serialized) as Record<string, unknown>;
  for (const key of HISTORY_KEYS) delete state[key];
  return JSON.stringify(state);
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const scrubLog = (lines: string[]) => lines.filter(line => !line.startsWith('|t:|'));

function facts(serialized: string): unknown {
  const state = JSON.parse(serialized) as {
    turn: number; ended: boolean; winner: string; prng: unknown;
    sides: { pokemonLeft: number; active: unknown[]; pokemon: { hp: number; fainted: boolean; status: string }[] }[];
  };
  return {
    turn: state.turn, ended: state.ended, winner: state.winner, prng: state.prng,
    sides: state.sides.map(side => ({
      pokemonLeft: side.pokemonLeft, active: side.active,
      hp: side.pokemon.map(pokemon => pokemon.hp),
      fainted: side.pokemon.map(pokemon => pokemon.fainted),
      status: side.pokemon.map(pokemon => pokemon.status),
    })),
  };
}

function capture(root: SimPosition): unknown {
  const p1Choices = legalChoices(root, 'p1').slice(0, 3);
  const p2Choices = legalChoices(root, 'p2').slice(0, 2);
  expect(p1Choices).toHaveLength(3);
  expect(p2Choices).toHaveLength(2);
  const children = [];
  for (const p1 of p1Choices) {
    for (const p2 of p2Choices) {
      for (const seed of SEEDS) {
        const { child, log } = advancePositionWithLog(root, p1.choice, p2.choice, seed);
        children.push({
          p1: p1.choice, p2: p2.choice, seed,
          state: sha256(stripHistory(child.serialized)),
          facts: facts(child.serialized),
          log: scrubLog(log),
        });
      }
    }
  }
  const settings = { depth: 1 as const, samples: 1 as const, tera: false as const };
  const matrix = searchPosition(root.serialized, { ...settings, mode: 'matrix' });
  const rows = (side: 'p1' | 'p2') => matrix.perSide[side].map(row => ({
    choice: row.choice, ev: row.ev, expected: row.expected, worstCase: row.worstCase, punishedBy: row.punishedBy,
  }));
  const tree = mctsTreeSearch(root.serialized, { ...settings, mode: 'mcts' }, 0);
  return {
    root: sha256(stripHistory(root.serialized)),
    children,
    matrix: {
      score: matrix.score, interval: matrix.interval, depthCompleted: matrix.depthCompleted, p1: rows('p1'), p2: rows('p2'),
      forcedWin: matrix.forcedWin ?? null,
    },
    mcts: {
      score: tree.result.score, visits: tree.visits, depth: tree.depth, rootValue: tree.rootValue,
      p1N: tree.p1N, p1W: tree.p1W, p2N: tree.p2N, p2W: tree.p2W,
      cells: tree.cells.map(cell => [cell.key, cell.visits, cell.total, cell.value, cell.ended]),
    },
  };
}

describe('fork and search identity', () => {
  test('children, the depth-1 matrix, and one MCTS tree match the recorded reference', { timeout: 120000 }, () => {
    // The reference holds a tree of the search before round 61 (600 iterations): the identity under test is the
    // speed layer's, not the budget's, so the tree runs with that budget.
    configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 600 });
    onTestFinished(() => configureSearchBudget(null));
    const singles = withHistory(createRootPosition(serialize(makeSixVsSix())), 3);
    const doubles = withHistory(createRootPosition(serialize(makeBattle('gen9doublescustomgame', doublesTeams.p1Team, doublesTeams.p2Team))), 2);
    // JSON round trip: the fixture cannot tell -0 from 0, and neither should the comparison.
    const captured = JSON.parse(JSON.stringify({ singles: capture(singles), doubles: capture(doubles) })) as unknown;
    if (RECORD) {
      writeFileSync(FIXTURE, JSON.stringify(captured, null, 2) + '\n');
      return;
    }
    expect(captured).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf-8')));
  });

  test('forks start from an empty log and leave the shared parsed state untouched', () => {
    const root = withHistory(createRootPosition(serialize(makeSixVsSix())), 3);
    const p1 = legalChoices(root, 'p1')[0].choice;
    const p2 = legalChoices(root, 'p2')[0].choice;
    const first = advancePositionWithLog(root, p1, p2, '1,2,3,4');
    const second = advancePositionWithLog(root, p1, p2, '1,2,3,4');
    // A child's log holds its own advance only, never a sibling's lines.
    expect(scrubLog(second.log)).toEqual(scrubLog(first.log));
    expect((JSON.parse(second.child.serialized) as { log: string[] }).log).toEqual(scrubLog(second.log));
    expect(second.log.length).toBeGreaterThan(0);

    // The parsed state is shared by every fork and must read the same after
    // two of them played a full turn from it.
    const parsed = parseSearchState(root.serialized);
    const before = JSON.stringify(parsed);
    const battles = [deserializeFromParsed(parsed), deserializeFromParsed(parsed)];
    for (const battle of battles) {
      battle.choose('p1', p1);
      battle.choose('p2', p2);
      expect(battle.log.length).toBeGreaterThan(0);
    }
    expect(battles[0].log).not.toBe(battles[1].log);
    expect(JSON.stringify(parsed)).toBe(before);
    expect(parsed.state.log).toEqual([]);
  });
});

describe('search-budget', () => {
  afterEach(() => configureSearchBudget(null));

  const TREE = { depth: 1, samples: 1, mode: 'mcts' } as const;
  const MATRIX = { depth: 1, samples: 1, mode: 'matrix' } as const;

  describe('search budget (round 61)', () => {
    test('the form chosen at the round-61 gate stays reachable through the switch: trees from the first turn', () => {
      configureSearchBudget(parseSearchBudget('singles-tree-from=0,singles-early-samples=1'));
      expect(searchBudgetTag()).not.toBe('');
      for (const doubles of [false, true]) {
        expect(autoTurnSettings(0, doubles)).toEqual(TREE);
        expect(autoTurnSettings(0.5, doubles)).toEqual(TREE);
      }
    });

    test('the search before round 61 stays reachable through the switch', () => {
      configureSearchBudget(parseSearchBudget(`iterations=600,tree-from=${AUTO_MCTS_FAINTED_FRACTION},early-samples=1`));
      for (const doubles of [false, true]) {
        expect(autoTurnSettings(0, doubles)).toEqual(MATRIX);
        expect(autoTurnSettings(AUTO_MCTS_FAINTED_FRACTION, doubles)).toEqual(TREE);
      }
    });

    test('the switch: a key=value list over the default', () => {
      expect(parseSearchBudget(undefined)).toBeNull();
      expect(parseSearchBudget('')).toBeNull();
      expect(parseSearchBudget('trees=8,iterations=1200')).toEqual({ ...SEARCH_BUDGET_DEFAULT, trees: 8, iterations: 1200 });
      const early = { earlyDepth: 3, earlySamples: 5, treeFrom: 0 };
      expect(parseSearchBudget('early-depth=3,early-samples=5,tree-from=0')).toEqual({ ...SEARCH_BUDGET_DEFAULT, singles: early, doubles: early });
      configureSearchBudget(parseSearchBudget('trees=16,tree-from=0'));
      expect(searchBudgetTag()).toBe('t16-i600-s1.3.0-d1.1.0-l1.1');
      expect(autoTurnSettings(0, false)).toEqual(TREE);
    });

    test('a typo or an unseeded value throws', () => {
      expect(() => parseSearchBudget('tres=8')).toThrow(/unknown key/);
      expect(() => parseSearchBudget('constructor=8')).toThrow(/unknown key/);
      expect(() => parseSearchBudget('early-samples=7')).toThrow(/early-samples/);
      expect(() => parseSearchBudget('early-depth=4')).toThrow(/early-depth/);
      expect(() => parseSearchBudget('trees=0')).toThrow(/trees/);
      expect(() => parseSearchBudget('tree-from=1.5')).toThrow(/tree-from/);
      expect(() => parseSearchBudget('tree-from=')).toThrow(/tree-from/);
    });

    test('tree seeds: a pure function of (offset, iteration), 16 trees draw 16 different sequences (round 86, T323)', () => {
      for (let offset = 0; offset < 5; offset++) {
        for (let iteration = 0; iteration < 12; iteration++) {
          expect(treeSeed(iteration, offset)).toBe(treeSeed(iteration, offset));
          expect(SEARCH_SEEDS).not.toContain(treeSeed(iteration, offset));
        }
      }
      const sequences = new Set(Array.from({ length: 16 }, (_, offset) =>
        Array.from({ length: 10 }, (_, iteration) => treeSeed(iteration, offset)).join('|')));
      expect(sequences.size).toBe(16);
      // no tree repeats a seed inside its own schedule: the lattice's five seeds came round every fifth iteration
      expect(new Set(Array.from({ length: 10 }, (_, iteration) => treeSeed(iteration, 0))).size).toBe(10);
    });
  });

  describe('search budget per game type (round 63, T110)', () => {
    test('the default splits auto by game type: early singles turns run the matrix with three draws, doubles the tree from the first turn', () => {
      expect(SEARCH_BUDGET_DEFAULT).toEqual({
        trees: 4, iterations: 600,
        singles: { earlyDepth: 1, earlySamples: 3, treeFrom: AUTO_MCTS_FAINTED_FRACTION },
        doubles: { earlyDepth: 1, earlySamples: 1, treeFrom: 0 },
        lead: { depth: 1, samples: 1 },
      });
      expect(searchBudget()).toEqual(SEARCH_BUDGET_DEFAULT);
      expect(searchBudgetTag()).toBe('');
      const early = { depth: 1, samples: 3, mode: 'matrix' } as const;
      expect(autoTurnSettings(0, false)).toEqual(early);
      expect(autoTurnSettings(AUTO_MCTS_FAINTED_FRACTION - 0.001, false)).toEqual(early);
      expect(autoTurnSettings(AUTO_MCTS_FAINTED_FRACTION, false)).toEqual(TREE);
      expect(autoTurnSettings(0, true)).toEqual(TREE);
      expect(autoTurnSettings(1, true)).toEqual(TREE);
    });

    test('the switch sets one game type or both, and the team-preview lead apart', () => {
      const singlesOne = parseSearchBudget('singles-early-samples=3,singles-early-depth=2')!;
      expect(singlesOne.singles).toEqual({ earlyDepth: 2, earlySamples: 3, treeFrom: SEARCH_BUDGET_DEFAULT.singles.treeFrom });
      expect(singlesOne.doubles).toEqual(SEARCH_BUDGET_DEFAULT.doubles);
      expect(singlesOne.lead).toEqual(SEARCH_BUDGET_DEFAULT.lead);
      const doublesOne = parseSearchBudget('doubles-tree-from=0.25')!;
      expect(doublesOne.doubles.treeFrom).toBe(0.25);
      expect(doublesOne.singles).toEqual(SEARCH_BUDGET_DEFAULT.singles);
      // The unprefixed keys keep their round-61 meaning for turns: both game types, never the lead.
      const both = parseSearchBudget('tree-from=0.25,early-samples=3')!;
      expect(both.singles).toEqual({ earlyDepth: 1, earlySamples: 3, treeFrom: 0.25 });
      expect(both.doubles).toEqual({ earlyDepth: 1, earlySamples: 3, treeFrom: 0.25 });
      expect(both.lead).toEqual({ depth: 1, samples: 1 });
      // Left to right: a game-type key after a both key wins for its game type.
      expect(parseSearchBudget('early-samples=5,singles-early-samples=1')!.singles.earlySamples).toBe(1);
      expect(parseSearchBudget('lead-depth=2,lead-samples=3')).toEqual({ ...SEARCH_BUDGET_DEFAULT, lead: { depth: 2, samples: 3 } });
      expect(() => parseSearchBudget('singles-early-samples=7')).toThrow(/singles-early-samples/);
      expect(() => parseSearchBudget('doubles-tree-from=2')).toThrow(/doubles-tree-from/);
      expect(() => parseSearchBudget('lead-depth=4')).toThrow(/lead-depth/);
      expect(() => parseSearchBudget('triples-tree-from=0')).toThrow(/unknown key/);
    });

    test('a form per game type routes each game type by its own split', () => {
      configureSearchBudget(parseSearchBudget('singles-tree-from=0.25,singles-early-samples=3'));
      expect(autoTurnSettings(0, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
      expect(autoTurnSettings(0.25, false)).toEqual(TREE);
      expect(autoTurnSettings(0, true)).toEqual(TREE);
      configureSearchBudget(parseSearchBudget('doubles-tree-from=0.25,doubles-early-depth=2'));
      expect(autoTurnSettings(0, true)).toEqual({ depth: 2, samples: 1, mode: 'matrix' });
      expect(autoTurnSettings(0.25, true)).toEqual(TREE);
      // The singles split keeps its default.
      expect(autoTurnSettings(0, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
    });

    test('tags tell apart forms that differ in one game type, and a form equal to the default keeps the plain key', () => {
      configureSearchBudget(parseSearchBudget('singles-tree-from=0.5'));
      const singlesTag = searchBudgetTag();
      configureSearchBudget(parseSearchBudget('doubles-tree-from=0.25'));
      const doublesTag = searchBudgetTag();
      configureSearchBudget(parseSearchBudget('lead-samples=3'));
      const leadTag = searchBudgetTag();
      expect(new Set([singlesTag, doublesTag, leadTag, '']).size).toBe(4);
      // Field by field, not by key order: a form that spells out the default is the default.
      configureSearchBudget(parseSearchBudget('early-samples=5,singles-early-samples=3,doubles-early-samples=1'));
      expect(searchBudgetTag()).toBe('');
      configureSearchBudget({
        lead: { samples: 1, depth: 1 }, doubles: { treeFrom: 0, earlySamples: 1, earlyDepth: 1 },
        singles: { treeFrom: AUTO_MCTS_FAINTED_FRACTION, earlySamples: 3, earlyDepth: 1 }, iterations: 600, trees: 4,
      });
      expect(searchBudgetTag()).toBe('');
    });
  });
});
