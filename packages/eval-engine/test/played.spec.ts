import { test, expect, describe, afterAll, beforeAll } from 'vitest';
import {
  parsePlayedActions,
  parsePlayedActionsDoubles,
  detectSacks,
  turnEvents,
  type PlayedBounds,
  type PlayedTurn,
} from '../src/played';
import { logRules, getBranchSimulatorFormat, replayRuleset, type ReplayData } from '@fulllifegames/replay-core';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import type { EvalResult, RankedChoice, EvalSettings } from '../src/types';
import { readFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { blendWorlds } from '../src/branch/bring-worlds';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeBattleStable } from '../src/forward/serialize';
import { mctsSearch, mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/search';
import { configureSearchBudget, parseSearchBudget } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { playedBoundsOf } from '../src/branch/action-bound';
import { playedIndices } from '../src/verify-select';
import type { SimBattle } from '../src/branch/types';
import type { StaticRuleset } from '../src/eval-function';
import { mon as fixtureMon, RULES } from './dice-fixtures';
import { battleOf } from './power-oracle';

describe('played-action parsing', () => {
  test('both sides move', () => {
    const played = parsePlayedActions([
      '|move|p1a: Kyurem|Draco Meteor|p2a: Cryogonal',
      '|-damage|p2a: Cryogonal|12/100',
      '|move|p2a: Cryogonal|Recover|p2a: Cryogonal',
      '|-heal|p2a: Cryogonal|62/100',
      '|upkeep',
      '|turn|5',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: false });
    expect(played.p2).toEqual({ kind: 'move', name: 'Recover', tera: false });
  });

  test('a chosen switch is the first action; the attack lands on the incomer', () => {
    const played = parsePlayedActions([
      '|switch|p2a: Dragapult|Dragapult, F|100/100',
      '|move|p1a: Kyurem|Draco Meteor|p2a: Dragapult',
      '|-supereffective|p2a: Dragapult',
      '|-damage|p2a: Dragapult|0 fnt',
      '|faint|p2a: Dragapult',
      '|switch|p2a: Cobalion|Cobalion|100/100',
      '|turn|6',
    ], logRules(''));
    expect(played.p2).toEqual({ kind: 'switch', name: 'Dragapult', species: 'Dragapult' });
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: false });
  });

  test('a cant records WHY the choice never surfaced', () => {
    // A sleeping mon whose turn is swallowed: the player DID choose; the
    // report should say sleep ate it, not "could not act".
    const slept = parsePlayedActions([
      '|move|p1a: Vileplume|Sleep Powder|p2a: Rhydon',
      '|cant|p2a: Rhydon|slp',
    ], logRules(''));
    expect(slept.p2).toBeNull();
    expect(slept.prevented?.p2).toBe('slp');
    expect(slept.prevented?.p1).toBeUndefined();

    // Taunt block carries the blocking move.
    const taunted = parsePlayedActions([
      '|cant|p1a: Uxie|move: Taunt|Stealth Rock',
      '|move|p2a: Salazzle|Flamethrower|p1a: Uxie',
    ], logRules(''));
    expect(taunted.prevented?.p1).toBe('move: Taunt');

    // A side that acted BEFORE the cant keeps its action, no reason.
    const moved = parsePlayedActions([
      '|move|p2a: Rhydon|Avalanche|p1a: Noivern',
      '|cant|p2a: Rhydon|flinch',
    ], logRules(''));
    expect(moved.p2?.name).toBe('Avalanche');
    expect(moved.prevented).toBeUndefined();
  });

  test('a faint replacement is not a chosen action', () => {
    const played = parsePlayedActions([
      '|move|p1a: Kyurem|Draco Meteor|p2a: Cryogonal',
      '|-damage|p2a: Cryogonal|0 fnt',
      '|faint|p2a: Cryogonal',
      '|switch|p2a: Cobalion|Cobalion|100/100',
      '|turn|7',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: false });
    // Cryogonal died before acting — p2's chosen action never surfaced.
    expect(played.p2).toBeNull();
    expect(played.prevented?.p2).toBe('faint');
  });

  test('a pivot switch after U-turn is the pair target, never a chosen switch', () => {
    const played = parsePlayedActions([
      '|move|p1a: Dragapult|U-turn|p2a: Snorlax',
      '|-damage|p2a: Snorlax|80/100',
      '|switch|p1a: Corviknight|Corviknight|100/100|[from] U-turn',
      '|move|p2a: Snorlax|Body Slam|p1a: Corviknight',
      '|turn|9',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'U-turn', tera: false, pivotTarget: 'Corviknight' });
    expect(played.p2).toEqual({ kind: 'move', name: 'Body Slam', tera: false });
  });

  test('terastallizing marks the move', () => {
    const played = parsePlayedActions([
      '|-terastallize|p1a: Kyurem|Dragon',
      '|move|p1a: Kyurem|Draco Meteor|p2a: Snorlax',
      '|move|p2a: Snorlax|Body Slam|p1a: Kyurem',
      '|turn|12',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: true });
    expect(played.p2).toEqual({ kind: 'move', name: 'Body Slam', tera: false });
  });

  test('a fully prevented side (sleep, flinch) stays unknown; drags are ignored', () => {
    const played = parsePlayedActions([
      '|cant|p2a: Snorlax|slp',
      '|move|p1a: Skarmory|Whirlwind|p2a: Snorlax',
      '|drag|p2a: Chansey|Chansey, F|100/100',
      '|turn|15',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'Whirlwind', tera: false });
    expect(played.p2).toBeNull();
  });
});

describe('doubles played-action parsing', () => {
  test('per-slot actions with foe/ally target locations', () => {
    const played = parsePlayedActionsDoubles([
      '|move|p1a: Flutter Mane|Moonblast|p2b: Chien-Pao',
      '|-damage|p2b: Chien-Pao|10/100',
      '|move|p2a: Incineroar|Fake Out|p1a: Flutter Mane',
      '|move|p1b: Rillaboom|Fake Out|p2a: Incineroar',
      '|switch|p2b: Urshifu|Urshifu, M|100/100',
      '|turn|4',
    ]);
    expect(played.p1Slots?.[0]).toEqual({ kind: 'move', name: 'Moonblast', tera: false, targetLoc: 2 });
    expect(played.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 });
    expect(played.p2Slots?.[0]).toEqual({ kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 });
    // Chien-Pao took damage but never acted — the switch is its chosen action.
    expect(played.p2Slots?.[1]).toEqual({ kind: 'switch', name: 'Urshifu', species: 'Urshifu' });
  });

  test('tera marks the slot, faint/cant settle only that slot', () => {
    const played = parsePlayedActionsDoubles([
      '|-terastallize|p1b: Rillaboom|Grass',
      '|move|p2a: Incineroar|Fake Out|p1a: Flutter Mane',
      '|cant|p1a: Flutter Mane|flinch',
      '|move|p1b: Rillaboom|Wood Hammer|p2a: Incineroar',
      '|-damage|p2a: Incineroar|0 fnt',
      '|faint|p2a: Incineroar',
      '|switch|p2a: Amoonguss|Amoonguss, F|100/100',
      '|move|p2b: Urshifu|Protect|',
      '|turn|9',
    ]);
    expect(played.p1Slots?.[0]).toBeNull(); // flinched — choice never surfaced
    expect(played.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Wood Hammer', tera: true, targetLoc: 1 });
    expect(played.p2Slots?.[0]).toEqual({ kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 });
    expect(played.p2Slots?.[1]).toEqual({ kind: 'move', name: 'Protect', tera: false, targetLoc: null });
  });

  test('ally-targeted moves get negative locations', () => {
    const played = parsePlayedActionsDoubles([
      '|move|p1a: Clefairy|Follow Me|p1a: Clefairy',
      '|move|p1b: Kingambit|Sucker Punch|p2a: Urshifu',
      '|turn|3',
    ]);
    expect(played.p1Slots?.[0]).toEqual({ kind: 'move', name: 'Follow Me', tera: false, targetLoc: -1 });
    expect(played.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Sucker Punch', tera: false, targetLoc: 1 });
  });
});

describe('mega evolution tracking', () => {
  test('doubles: |-mega| marks the slot and the move carries the flag', () => {
    const played = parsePlayedActionsDoubles([
      '|-mega|p1a: Lacksatives|Lucario|Lucarionite',
      '|move|p1a: Lacksatives|Close Combat|p2a: Incineroar',
      '|move|p1b: Partner|Protect|',
      '|turn|3',
    ]);
    expect(played.p1Slots?.[0]).toEqual({
      kind: 'move', name: 'Close Combat', tera: false, mega: true, targetLoc: 1,
    });
    expect(played.p1Slots?.[1]?.mega).toBeUndefined();
  });

  test('singles: mega moves match the mega variant, never the base option', () => {
    const played = parsePlayedActions([
      '|-mega|p1a: Lucario|Lucario|Lucarionite',
      '|move|p1a: Lucario|Close Combat|p2a: Snorlax',
      '|turn|3',
    ], logRules(''));
    expect(played.p1?.mega).toBe(true);
  });
});

describe('pivot pair targets', () => {
  test('the follow-up switch after a pivot move records the pair target', () => {
    const played = parsePlayedActions([
      '|move|p1a: Mien|U-turn|p2a: Chomp',
      '|-damage|p2a: Chomp|150/200',
      '|switch|p1a: Clef|Clefable, F|100/100',
      '|move|p2a: Chomp|Earthquake|p1a: Clef',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'U-turn', tera: false, pivotTarget: 'Clefable' });
  });

  test('replacements after a non-pivot move record nothing', () => {
    const played = parsePlayedActions([
      '|move|p1a: Mien|Close Combat|p2a: Chomp',
      '|move|p2a: Chomp|Earthquake|p1a: Mien',
      '|faint|p1a: Mien',
      '|switch|p1a: Clef|Clefable, F|100/100',
    ], logRules(''));
    expect(played.p1).toEqual({ kind: 'move', name: 'Close Combat', tera: false });
  });
});

const mon = (name: string, speciesForme: string, hpPercent: number, isActive: boolean) => ({
  name, speciesForme, hp: hpPercent, maxhp: 100, hpPercent,
  status: '', fainted: false, isActive, boosts: {}, moves: [],
  ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const snapshot = (p1: ReturnType<typeof mon>[], p2: ReturnType<typeof mon>[]): TurnSnapshot => ({
  turn: 25,
  p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: p1 },
  p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: p2 },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
});

describe('655336 t25: the sack recognition', () => {
  test('singles: Lopunny-Mega at 14% into Stealth Rock and Spikes is a low-HP hazard sack', () => {
    const events = [
      '|switch|p2a: Lopunny|Lopunny-Mega, F|38/271',
      '|-damage|p2a: Lopunny|22/271|[from] Stealth Rock',
      '|-damage|p2a: Lopunny|0 fnt|[from] Spikes',
      '|faint|p2a: Lopunny',
      '|move|p1a: Charizard|Dragon Claw|p2: Lopunny|[notarget]',
      '|-fail|p1a: Charizard',
      '|upkeep',
      '|switch|p2a: Slowbro|Slowbro, M|293/393 par',
    ];
    const before = snapshot(
      [mon('Charizard', 'Charizard-Mega-X', 100, true)],
      [mon('Slowbro', 'Slowbro', 75, true), mon('Lopunny', 'Lopunny-Mega', 14, false)],
    );
    expect(detectSacks(events, before, logRules('')).p2).toEqual({
      name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 0.14, hazard: true,
    });
  });

  test('doubles: the same switch into the hazards on slot b is a low-HP hazard sack of its side', () => {
    const events = [
      '|switch|p2b: Lopunny|Lopunny-Mega, F|38/271',
      '|-damage|p2b: Lopunny|22/271|[from] Stealth Rock',
      '|-damage|p2b: Lopunny|0 fnt|[from] Spikes',
      '|faint|p2b: Lopunny',
      '|move|p1a: Charizard|Dragon Claw|p2a: Slowbro',
    ];
    const before = snapshot(
      [mon('Charizard', 'Charizard-Mega-X', 100, true)],
      [mon('Slowbro', 'Slowbro', 75, true), mon('Amoonguss', 'Amoonguss', 90, true), mon('Lopunny', 'Lopunny-Mega', 14, false)],
    );
    expect(detectSacks(events, before, logRules('')).p2).toEqual({
      name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 0.14, hazard: true,
    });
  });
});

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number, punishedBy: string | null): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy });

/** The turn at one set of numbers: Protect is the engine's best, the switch is the played row. */
const t25 = (numbers: { score: number; protect: [number, number, number]; lopunny: [number, number, number] }, overrides: Partial<AnalyzeTurnParams> = {}) => {
  const result: EvalResult = {
    score: numbers.score, interval: 0, depthCompleted: 2,
    perSide: {
      p1: [ranked('move dragonclaw', 'Dragon Claw', 0.64, 0.77, 0.68, 'Protect')],
      p2: [
        ranked('move protect', 'Protect', numbers.protect[0], numbers.protect[1], numbers.protect[2], 'Roost'),
        ranked('switch 4', '→ Lopunny-Mega', numbers.lopunny[0], numbers.lopunny[1], numbers.lopunny[2], 'Roost'),
      ],
    },
  };
  return analyzeTurn({
    turn: 25, result,
    played: { p1: { kind: 'move', name: 'Dragon Claw' }, p2: { kind: 'switch', name: 'Lopunny', species: 'Lopunny-Mega' } },
    playedOutcome: 0.838, futureOutcomes: [0.8, 0.82, 0.8],
    scoreBefore: numbers.score, scoreAfter: 0.699,
    sacks: { p2: { name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 38 / 271, hazard: true } },
    ...overrides,
  });
};

describe('655336 t25: the gate at both sets of numbers', () => {
  /** The feedback dump at a2e7c2b: score 0.6958, Protect -0.6779, the switch -0.7343, regret 0.0563. */
  const head = { score: 0.6958, protect: [-0.7263, -0.6224, -0.6779] as [number, number, number], lopunny: [-0.775, -0.7201, -0.7343] as [number, number, number] };
  /** The round-70 dump (0da5ec7 to 8683fa9): score 0.3337, Protect -0.2773, the switch -0.6929, regret 0.4156. */
  const r70 = { score: 0.3337, protect: [-0.45, -0.3, -0.2773] as [number, number, number], lopunny: [-0.9, -0.7, -0.6929] as [number, number, number] };

  test('at the dump of the a2e7c2b engine the turn has no tier and no blame', () => {
    const analysis = t25(head);
    expect(analysis.p2.regret).toBeCloseTo(0.0563, 3);
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.attribution).not.toBe('p2-decision');
  });

  test('the mirror, p1 on the switch, reads the same (the gate has no side; rows are own-perspective)', () => {
    const mirrored = analyzeTurn({
      turn: 25,
      result: {
        score: -head.score, interval: 0, depthCompleted: 2,
        perSide: {
          p1: [ranked('move protect', 'Protect', head.protect[0], head.protect[1], head.protect[2], 'Roost'),
            ranked('switch 4', '→ Lopunny-Mega', head.lopunny[0], head.lopunny[1], head.lopunny[2], 'Roost')],
          p2: [ranked('move dragonclaw', 'Dragon Claw', 0.64, 0.77, 0.68, 'Protect')],
        },
      },
      played: { p1: { kind: 'switch', name: 'Lopunny', species: 'Lopunny-Mega' }, p2: { kind: 'move', name: 'Dragon Claw' } },
      playedOutcome: -0.838, futureOutcomes: [-0.8, -0.82, -0.8],
      scoreBefore: -head.score, scoreAfter: -0.699,
      sacks: { p1: { name: 'Lopunny', species: 'Lopunny-Mega', hpFraction: 38 / 271, hazard: true } },
    });
    expect(mirrored.p1.regret).toBeCloseTo(0.0563, 3);
    expect(mirrored.p1.tier).toBeUndefined();
  });

  test('a luck-free window that repays the regret stamps the sack (the form the dump lacks: the position after the pair read 0.139 better for p2)', () => {
    // The pair's value is what came (own outcome -0.838 against the after score -0.838) and the window reaches over the safe floor by the margin.
    const analysis = t25(head, { scoreAfter: 0.838, futureOutcomes: [0.3, 0.3, 0.3] });
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.sacrifice).toMatchObject({ name: 'Lopunny', hazard: true, verified: true });
  });

  test('the dump as it is earns no stamp: the position after the pair beat the pair by more than the epsilon', () => {
    expect(t25(head).p2.sacrifice).toBeUndefined();
  });

  test('at the round-70 numbers a blunder-sized hazard sack still grades, even with a paying window', () => {
    const analysis = t25(r70, { scoreAfter: 0.838, futureOutcomes: [0.3, 0.3, 0.3] });
    expect(analysis.p2.regret).toBeCloseTo(0.4156, 3);
    expect(analysis.p2.tier).toBe('blunder');
    expect(analysis.p2.sacrifice).toBeUndefined();
  });
});

await loadSimMods(getBranchSimulatorFormat(JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmc-2710981835.json', import.meta.url), 'utf-8')) as ReplayData));

describe('played-bounds-attach', () => {
  const mon = fixtureMon;
  const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmc-2710981835.json', import.meta.url), 'utf-8')) as ReplayData;

  beforeAll(() => configureSearchBudget(parseSearchBudget('trees=2,iterations=50')));
  afterAll(() => configureSearchBudget(null));

  interface Scene { name: string; doubles: boolean; serialized: string; ruleset: StaticRuleset; played: PlayedTurn; battle?: SimBattle }

  const GEN9 = RULES.find(entry => entry.generation === 9)!;
  const grafaiai = () => ({ ...mon(GEN9, { species: 'Grafaiai', moves: ['partingshot', 'lowkick', 'foulplay', 'gunkshot'], gender: 'M' }), ability: 'prankster', item: 'choiceband' });
  const valiant = () => mon(GEN9, { species: 'Iron Valiant', moves: ['psyshock', 'closecombat'], gender: 'M' });
  const snorlax = () => mon(GEN9, { species: 'Snorlax', moves: ['bodyslam', 'rest'], gender: 'M' });
  const pikachu = () => mon(GEN9, { species: 'Pikachu', moves: ['thunderbolt', 'surf'] });

  function constructed(doubles: boolean): Scene {
    const board: Battle = doubles
      ? battleOf(GEN9.doubles!, [grafaiai(), snorlax()], [valiant(), pikachu()])
      : battleOf(GEN9.singles, [grafaiai(), snorlax()], [valiant(), pikachu()]);
    const lines = doubles
      ? ['|move|p2a: Iron Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai', '|move|p1b: Snorlax|Body Slam|p2b: Pikachu', '|move|p2b: Pikachu|Thunderbolt|p1b: Snorlax']
      : ['|move|p2a: Iron Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai'];
    const played = doubles ? parsePlayedActionsDoubles(lines) : parsePlayedActions(lines, logRules(''));
    return {
      name: doubles ? 'Doubles OU, constructed (Prankster Grafaiai)' : 'singles, constructed (Prankster Grafaiai)', doubles,
      serialized: serializeBattleStable(board), ruleset: 'standard', played, battle: board as unknown as SimBattle,
    };
  }

  const champions = (): Scene => ({
    name: 'Champions VGC 2710981835 turn 7', doubles: true,
    serialized: (JSON.parse(readFileSync(new URL('./fixtures/played-bounds/gen9championsvgc2026regmc-2710981835-t7.json', import.meta.url), 'utf-8')) as { serialized: string }).serialized,
    ruleset: replayRuleset(replay), played: parsePlayedActionsDoubles(turnEvents(replay.log, 7)),
  });

  const SCENES = [champions(), constructed(true), constructed(false)];
  const EXPECTED: Record<string, PlayedBounds> = {
    'Champions VGC 2710981835 turn 7': { p1: [{ moves: ['extremespeed', 'protect'], switchOut: true }, null] },
  };

  const settingsOf = (scene: Scene, over: Partial<EvalSettings> = {}): EvalSettings =>
    ({ depth: 1, samples: 1, mode: 'matrix', tera: false, sleepClause: false, ruleset: scene.ruleset, prove: false, keepPlayed: scene.played, ...over });

  /** What the rows must carry: the bound of the root battle itself (the champions row also pins the report's two moves). */
  function expectedBounds(scene: Scene): PlayedBounds {
    const named = EXPECTED[scene.name];
    if (named) return named;
    const bounds = playedBoundsOf(scene.battle!, scene.played.fell);
    expect(bounds).toBeDefined();
    return bounds!;
  }

  describe.each(SCENES)('$name', scene => {
    const want = () => expectedBounds(scene);
    const mcts = (over: Partial<EvalSettings> = {}) => settingsOf(scene, { mode: 'mcts', ...over });

    test('the parse marks a fallen slot, and the keep of the search carries the mark', () => {
      expect(scene.played.fell).toBeDefined();
      expect(structuredClone(scene.played.fell)).toEqual(scene.played.fell);
    });

    test('a tree\'s result carries the bound, and so do the partial results', () => {
      const partials: EvalResult[] = [];
      const tree = mctsTreeSearch(scene.serialized, mcts(), 0, { onPartial: result => partials.push(result) });
      expect(tree.result.playedBounds).toEqual(want());
      expect(partials.length).toBeGreaterThan(0);
      expect(partials.every(result => result.playedBounds !== undefined)).toBe(true);
    }, 240_000);

    test('a single in-process tree carries it', () => {
      expect(mctsSearch(scene.serialized, mcts()).playedBounds).toEqual(want());
    }, 240_000);

    test('the merge keeps it: two trees, and one tree with a verify map', () => {
      const trees = [0, 1].map(offset => mctsTreeSearch(scene.serialized, mcts(), offset));
      expect(mergeMctsTrees(trees).playedBounds).toEqual(want());
      expect(mergeMctsTrees([trees[0]], new Map()).playedBounds).toEqual(want());
      expect(mergeMctsTrees([trees[0]]).playedBounds).toEqual(want());
    }, 240_000);

    test('the tree orchestration returns it', async () => {
      const result = await searchTreesOrchestrated(createLocalTreeExecutor(scene.serialized, scene.ruleset), mcts());
      expect(result.playedBounds).toEqual(want());
    }, 600_000);

    test('the matrix search carries it, orchestrated and in process', async () => {
      const orchestrated = await searchOrchestrated(createLocalExecutor(scene.serialized, scene.ruleset), settingsOf(scene));
      expect(orchestrated.playedBounds).toEqual(want());
      expect(searchPosition(scene.serialized, settingsOf(scene)).playedBounds).toEqual(want());
    }, 600_000);

    test('the choices info of the executor carries it (the HTTP engine path reads it there)', async () => {
      const info = await createLocalExecutor(scene.serialized, scene.ruleset).choices(false, scene.played, false);
      expect(info.playedBounds).toEqual(want());
    }, 240_000);

    test('the bound plain data survives the worker boundary', () => {
      expect(structuredClone(want())).toEqual(want());
    });

    test('a turn that did not fall before acting has none, and no keep has none', async () => {
      const quiet: PlayedTurn = { ...scene.played };
      delete quiet.fell;
      expect(mctsTreeSearch(scene.serialized, mcts({ keepPlayed: quiet }), 0).result.playedBounds).toBeUndefined();
      const info = await createLocalExecutor(scene.serialized, scene.ruleset).choices(false, undefined, false);
      expect(info.playedBounds).toBeUndefined();
      expect(searchPosition(scene.serialized, settingsOf(scene, { keepPlayed: undefined })).playedBounds).toBeUndefined();
    }, 240_000);
  });

  const option = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
  const DOUBLES_ROWS = [
    option('move extremespeed 1, move flashcannon 1', 'Extreme Speed→Floette + Flash Cannon→Floette', 0.9),
    option('move protect, move flashcannon 1', 'Protect + Flash Cannon→Floette', 0.8),
    option('switch 3, move flashcannon 1', '→ Sylveon + Flash Cannon→Floette', 0.95),
    option('move dragonpulse 1, move flashcannon 1', 'Dragon Pulse→Floette + Flash Cannon→Floette', 0.5),
    option('move thunderbolt 1, move flashcannon 1', 'Thunderbolt→Floette + Flash Cannon→Floette', 0.4),
  ];
  const BOUND: PlayedBounds = { p1: [{ moves: ['extremespeed', 'protect'], switchOut: true }, null] };
  const resultOf = (playedBounds?: PlayedBounds): EvalResult => ({
    score: 0, interval: 0, depthCompleted: 1, perSide: { p1: DOUBLES_ROWS, p2: [option('move dazzlinggleam, move protect', 'Dazzling Gleam + Protect', 0)] },
    ...(playedBounds ? { playedBounds } : {}),
  });
  const played: PlayedTurn = {
    p1: null, p2: null, p1Slots: [null, { kind: 'move', name: 'Flash Cannon', tera: false, targetLoc: 1 }],
    p2Slots: [{ kind: 'move', name: 'Dazzling Gleam', tera: false, targetLoc: null }, { kind: 'move', name: 'Protect', tera: false, targetLoc: null }],
  };

  describe('the grading reads the bound from the result', () => {
    const grade = (result: EvalResult) => analyzeTurn({ turn: 7, result, played, playedOutcome: null, scoreBefore: 0, scoreAfter: null }).p1;

    test('with the bound the played row is Dragon Pulse + Flash Cannon; without it the grading is as before', () => {
      expect(grade(resultOf(BOUND)).played?.choice).toBe('move dragonpulse 1, move flashcannon 1');
      expect(grade(resultOf()).played?.choice).toBe('switch 3, move flashcannon 1');
      expect(grade(resultOf(BOUND)).regret).toBeGreaterThan(grade(resultOf()).regret ?? 1);
    });

    test('the verify selection prices the same played row', () => {
      const trees = [{ p1Options: DOUBLES_ROWS.map(({ choice, label }) => ({ choice, label })), p2Options: [] }] as never;
      expect(playedIndices(trees, resultOf(BOUND), played)).toEqual({ p1: 3 });
      expect(playedIndices(trees, resultOf(), played)).toEqual({ p1: 2 });
    });
  });

  describe('a game with several worlds keeps the frame\'s bound', () => {
    test('the heaviest world is the frame, and its bound stays on the blend', () => {
      const light = resultOf({ p1: [{ moves: [], switchOut: false }, null] });
      const blended = blendWorlds([light, resultOf(BOUND)], [0.4, 0.6]);
      expect(blended.playedBounds).toEqual(BOUND);
      expect(blendWorlds([resultOf(BOUND)], [1]).playedBounds).toEqual(BOUND);
    });
  });
});

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const choiceEv = (choiceStr: string, label: string, worstCase: number, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev, punishedBy: 'Reply' });

const sackSnapshot = (hpPercent: number): TurnSnapshot => ({
  turn: 73,
  p1: {
    name: 'P1', id: 'p1', sideConditions: {},
    pokemon: [{
      name: 'Dauni', speciesForme: 'Uxie', hp: 17, maxhp: 182, hpPercent,
      status: '', fainted: false, isActive: true, boosts: {}, moves: [],
      ability: '', item: '', terastallized: '', level: 50, gender: '',
    }],
  },
  p2: { name: 'P2', id: 'p2', pokemon: [], sideConditions: {} },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
});

describe('a death after the mon\'s own dice-failed action', () => {
  test('detectSacks carries the rolled flag for a miss or a dice |cant|', () => {
    const missed = [
      '|move|p1a: Dauni|Fire Fang|p2a: Wall|[miss]',
      '|-miss|p1a: Dauni|p2a: Wall',
      '|move|p2a: Wall|Body Press|p1a: Dauni',
      '|-damage|p1a: Dauni|0 fnt',
      '|faint|p1a: Dauni',
    ];
    expect(detectSacks(missed, sackSnapshot(11), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.11, rolled: 'miss' } });
    // Older logs carry only the |-miss| line.
    expect(detectSacks(missed.filter(line => !line.includes('[miss]')), sackSnapshot(11), logRules('')))
      .toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.11, rolled: 'miss' } });
    // A dice |cant| (full paralysis, flinch, freeze, sleep) is the same shape; Taunt is not dice.
    const paralyzed = ['|cant|p1a: Dauni|par', '|move|p2a: Wall|Body Press|p1a: Dauni', '|-damage|p1a: Dauni|0 fnt', '|faint|p1a: Dauni'];
    expect(detectSacks(paralyzed, sackSnapshot(11), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.11, rolled: 'cant' } });
    const taunted = ['|cant|p1a: Dauni|move: Taunt|Toxic', '|move|p2a: Wall|Body Press|p1a: Dauni', '|-damage|p1a: Dauni|0 fnt', '|faint|p1a: Dauni'];
    expect(detectSacks(taunted, sackSnapshot(11), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.11 } });
    // The opponent's miss says nothing about the fainted mon's own action.
    const theirMiss = ['|move|p2a: Wall|Stone Edge|p1a: Dauni|[miss]', '|-miss|p2a: Wall|p1a: Dauni', '|-damage|p1a: Dauni|0 fnt|[from] Stealth Rock', '|faint|p1a: Dauni'];
    expect(detectSacks(theirMiss, sackSnapshot(11), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.11 } });
    // The stayed shape carries the flag too.
    expect(detectSacks(missed, sackSnapshot(46), logRules(''))).toEqual({ p1: { name: 'Dauni', species: 'Uxie', hpFraction: 0.46, stayed: true, rolled: 'miss' } });
  });

  test('a rolled death with a knock-out chance is no sack; without odds the feed reading stands', () => {
    // The played move would have knocked the target out (95% × 1) and the
    // mon moved first: a hit keeps it alive. The miss killed it, so the
    // low-cost-trade framing is false — the regret grades as played.
    const rolledResult: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [
          choiceEv('move scaleshot', 'Scale Shot', 0.2, 0.2),
          { ...choiceEv('move firefang', 'Fire Fang', 0.0, 0.0), koOdds: { accuracy: 0.95, killFraction: 1 } },
        ],
        p2: [choice('move bodypress', 'Body Press', -0.05)],
      },
    };
    const run = (sack: { name: string; hpFraction: number; rolled?: 'miss' | 'cant' }, koOdds = true) => analyzeTurn({
      turn: 73,
      result: koOdds ? rolledResult : {
        ...rolledResult,
        perSide: { ...rolledResult.perSide, p1: rolledResult.perSide.p1.map(entry => ({ ...entry, koOdds: undefined })) },
      },
      played: {
        p1: { kind: 'move', name: 'Fire Fang', tera: false },
        p2: { kind: 'move', name: 'Body Press', tera: false },
      },
      playedOutcome: -0.1,
      scoreBefore: 0.1,
      scoreAfter: -0.3,
      sacks: { p1: sack },
    });
    const rolled = run({ name: 'Garchomp', hpFraction: 0.11, rolled: 'miss' });
    expect(rolled.p1.sacrifice).toBeUndefined();
    expect(rolled.p1.tier).toBe('mistake');
    // Without the roll the low-HP feed reads as before: demoted, framed as a sack.
    const fed = run({ name: 'Garchomp', hpFraction: 0.11 });
    expect(fed.p1.sacrifice).toEqual({ name: 'Garchomp', hpFraction: 0.11 });
    expect(fed.p1.tier).toBe('inaccuracy');
    // A rolled death whose move carried no knock-out chance stays a feed (conservative).
    const noOdds = run({ name: 'Garchomp', hpFraction: 0.11, rolled: 'miss' }, false);
    expect(noOdds.p1.sacrifice).toBeTruthy();
  });

  test('labeled doubles odds may be the partner slot\'s: a rolled death stays a feed (final review, finding 3)', () => {
    // Round 56: a doubles option's odds name one slot's move and target, which may be the partner's. Until
    // the odds name their attacker, the rule reads labeled odds as none: the same turn as the rolled case
    // above, with a label on the odds, frames the sack like the case without odds.
    const result: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [
          choiceEv('move scaleshot', 'Scale Shot', 0.2, 0.2),
          { ...choiceEv('move firefang', 'Fire Fang', 0.0, 0.0), koOdds: { accuracy: 0.95, killFraction: 1, label: 'Heat Wave→Wall' } },
        ],
        p2: [choice('move bodypress', 'Body Press', -0.05)],
      },
    };
    const analysis = analyzeTurn({
      turn: 73,
      result,
      played: {
        p1: { kind: 'move', name: 'Fire Fang', tera: false },
        p2: { kind: 'move', name: 'Body Press', tera: false },
      },
      playedOutcome: -0.1,
      scoreBefore: 0.1,
      scoreAfter: -0.3,
      sacks: { p1: { name: 'Garchomp', hpFraction: 0.11, rolled: 'miss' } },
    });
    expect(analysis.p1.sacrifice).toBeTruthy();
  });
});
