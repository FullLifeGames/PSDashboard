import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID, PRNG } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { proveForcedWin, PROVER_BUDGET, ForcedWinProver as Prover } from '../src/endgame/prover';
import { MIN_FORCED_MASS, type TeraAllowance } from '../src/types';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { deserializeBattleExact } from '../src/forward/serialize';
import { endgameChildren } from '../src/endgame/children';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
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
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

function serializeAt(battle: Battle, hp: { p1?: number[]; p2?: number[] }): string {
  for (const side of ['p1', 'p2'] as const) {
    (hp[side] ?? []).forEach((value, index) => { battle.sides[side === 'p1' ? 0 : 1].pokemon[index].hp = value; });
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const tossVsEgg = () => serializeAt(makeBattle(
  [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Protect'])],
  [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
), { p2: [1] });

describe('forced-win prover', () => {
  test('a certain knock-out proves in one turn with no caveat', () => {
    const proof = proveForcedWin(tossVsEgg(), { side: 'p1', rootOrder: ['move seismictoss', 'move protect'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(1);
    expect(proof.caveat).toBe('none');
    expect(proof.open).toBeUndefined();
    expect(proof.openValue).toBeNull();
  });

  test('a stalling first candidate no longer starves the second: the sure strike goes first, whatever the ranking says', () => {
    // No greedy scout filters the stalling line out. The position has a sure strike (Seismic Toss kills the Chansey at 1 HP, and the Chansey
    // has no damaging move), which the proof tries before the ranking and on cells of its own, so Splash first reads the win the Toss-first
    // ranking reads, at the same cells; the next row holds a position where the ranking still decides.
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Splash'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled', 'Recover'])],
    ), { p2: [1] });
    const stalling = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move splash', 'move seismictoss'], tera: false });
    const winning = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss', 'move splash'], tera: false });
    for (const proof of [stalling, winning]) {
      expect(proof.mass).toBe(1);
      expect(proof.turns).toBe(1);
      expect(proof.cells).toBe(2);
    }
  });

  test('with no sure strike the ranking decides which three candidates the proof tries: a winner listed fourth is never tried, listed first it wins', () => {
    // A foe with a second body takes the strike away (D2 a: only a last standing body), and the Snorlax's Tackle kills the Pikachu at
    // 1 HP unless the first move does: only Seismic Toss wins, this turn. The proof tries ROOT_CANDIDATES (3) of the ranking.
    const serialized = serializeAt(makeBattle(
      [makeSet('Pika', 'Pikachu', ['Splash', 'Growl', 'Harden', 'Seismic Toss'])],
      [makeSet('Lax', 'Snorlax', ['Tackle']), makeSet('Lax2', 'Snorlax', ['Tackle'])],
    ), { p1: [1], p2: [30, 30] });
    const fourth = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move splash', 'move growl', 'move harden', 'move seismictoss'], tera: false });
    expect(fourth.mass).toBe(0);
    const first = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss', 'move splash', 'move growl', 'move harden'], tera: false });
    expect(first.mass).toBe(1);
    expect(first.turns).toBe(2);
  });

  test('the losing side proves nothing', () => {
    const proof = proveForcedWin(tossVsEgg(), { side: 'p2', rootOrder: ['move softboiled'], tera: false });
    expect(proof.mass).toBe(0);
  });

  test('a 70% roll proves its hit class and names the open miss', () => {
    const serialized = serializeAt(makeBattle(
      [{ ...makeSet('Jolt', 'Jolteon', ['Thunder']), evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 } }],
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
    ), { p1: [1], p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move thunder'], tera: false });
    expect(proof.mass).toBeCloseTo(0.7, 6);
    expect(proof.turns).toBe(1);
    expect(proof.caveat).toBe('none');
    expect(proof.open).toEqual({ side: 'p1', moveId: 'thunder', label: 'Thunder', odds: 0.7, kind: 'hit' });
    // The miss child ends with Machamp's answer: the open branch is a lost game.
    expect(proof.openValue).toBe(-1);
  });

  test('a singles speed tie with mutual knock-outs proves exactly one half', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('A', 'Pikachu', ['Tackle'])],
      [makeSet('B', 'Pikachu', ['Tackle'])],
    ), { p1: [1], p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move tackle'], tera: false });
    expect(proof.mass).toBeCloseTo(0.5, 6);
    expect(proof.mass).toBeGreaterThanOrEqual(MIN_FORCED_MASS);
    expect(proof.openValue).toBe(-1);
  });

  test('a position without a line costs the proof its budget and no more', () => {
    // Protect and Substitute on both sides: no line ends, so the full proof refutes the candidates inside the cell and state
    // budgets and proves nothing.
    const serialized = serializeAt(makeBattle(
      [makeSet('A', 'Snorlax', ['Protect', 'Substitute'])],
      [makeSet('B', 'Chansey', ['Protect', 'Substitute'])],
    ), {});
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move protect', 'move substitute'], tera: false });
    expect(proof.mass).toBe(0);
    expect(proof.cells).toBeLessThanOrEqual(PROVER_BUDGET.cells);
    expect(proof.states).toBeLessThanOrEqual(PROVER_BUDGET.states);
  });

  test('a two-turn proof against four replies fits the budget', () => {
    // Seismic Toss twice against a 150-HP Chansey with four harmless moves:
    // four replies at the root, four children each proving in one more turn.
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Splash', 'Growl', 'Tail Whip', 'Defense Curl'])],
    ), { p2: [150] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.cells).toBeLessThanOrEqual(PROVER_BUDGET.cells);
  });

  test('a class no draw showed inherits the proof of the class that dominates it', () => {
    // Toxic hits 90% of the time; the inner cells draw three seeds, which
    // often never miss. A miss of the opponent's move is never better for
    // them than the hit, so the missing class inherits the hit class's proof
    // and the two Seismic Tosses prove with the full mass.
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Toxic', 'Splash', 'Growl', 'Tail Whip'])],
    ), { p2: [150] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
  });

  test('a two-turn win needs the budget; one state cannot prove it', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Egg2', 'Chansey', ['Soft-Boiled'])],
    ), { p2: [1, 1] });
    const starved = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false, budget: { states: 1 } });
    expect(starved.mass).toBe(0);
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.states).toBeLessThanOrEqual(PROVER_BUDGET.states);
    expect(proof.states).toBeLessThanOrEqual(4);
  });

  test('a surviving defender along the line labels the proof barring a crit', () => {
    // Thunderbolt kills the Machamp on some rolls and leaves it in range
    // on the rest; it cannot hurt back (Splash), so both classes prove and
    // the survived hit, unpriced for a crit, labels the proof.
    const serialized = serializeAt(makeBattle(
      [{ ...makeSet('Jolt', 'Jolteon', ['Thunderbolt']), evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 } }],
      [makeSet('Champ', 'Machamp', ['Splash'])],
    ), { p2: [165] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move thunderbolt'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.caveat).toBe('barring-crit');
  });

  test('fixed damage cannot crit, so a Seismic Toss line proves without the label', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Splash'])],
    ), { p2: [150] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.caveat).toBe('none');
  });

  test('doubles: a plain-path proof carries the sampled-rolls label', () => {
    // A doubles field needs two slots per side: the Chansey's partner has fainted.
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Champ2', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    battle.sides[1].active[1]!.faint();
    battle.resolveFaints();
    const serialized = serializeAt(battle, { p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: [], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(1);
    expect(proof.caveat).toBe('sampled-rolls');
  });
});

describe('forced-win-default-path', () => {
  interface Scene { serialized: string; side: 'p1' | 'p2'; rootOrder?: string[]; tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset }
  const load = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), 'utf-8'));

  const budget = (name: string): Scene => {
    const board = load(`forced-win/budget-${name}`);
    const side = board.expected.side as 'p1' | 'p2';
    return { serialized: board.serialized, side, rootOrder: board.input.rootOrder[side], tera: board.input.tera ?? false, sleepClause: board.input.sleepClause ?? false, ruleset: board.input.ruleset };
  };

  const SCENES: Array<[string, () => Scene, 'doubles' | 'singles']> = [
    ...['gen9doublesou-2695084835-t8', 'gen9vgc2026regf-2532857804-t7'].map(name => [`budget ${name}`, () => budget(name), 'doubles'] as [string, () => Scene, 'doubles']),
    ...['plain-dice-gen9championsvgc2026regmbbo3-2679549596-t7', 'plain-dice-gen9vgc2025regi-2408473310-t13',
      'scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 'scout-miss-gen9championsvgc2026regmc-2694684816-t8',
      'scout-miss-gen9doublesou-2661746817-t8', 'scout-miss-gen9vgc2024regg-2163312677-t8',
    ].map(name => [name, () => load(`forced-win/${name}`) as Scene, 'doubles'] as [string, () => Scene, 'doubles']),
    ...[['smogtours-gen9ou-749351-t10', 'p1'], ['smogtours-gen9ou-749828-t23', 'p2']].map(([name, side]) =>
      [name, () => ({ ...load(`positions/${name}`), side, rootOrder: [] }) as Scene, 'singles'] as [string, () => Scene, 'singles']),
  ];

  const recorded: Record<string, unknown> = process.env.RECORD_DEFAULT_PATH ? {} : load('forced-win-default-path');

  describe('the prover on its default path reads as before the win paths', () => {
    test.each(SCENES)('%s', { timeout: 240_000 }, async (name, scene, mode) => {
      const board = scene();
      await loadSimMods('gen9championsou');
      await loadSimMods(mode === 'doubles' ? (board.ruleset === 'champions' ? 'gen9championsdoublescustomgame' : 'gen9doublescustomgame') : 'gen9customgame');
      const proof = proveForcedWin(board.serialized, { side: board.side, rootOrder: board.rootOrder ?? [], tera: board.tera ?? false, sleepClause: board.sleepClause, ruleset: board.ruleset });
      const actual = JSON.parse(JSON.stringify(proof));
      if (process.env.RECORD_DEFAULT_PATH) {
        recorded[name] = actual;
        writeFileSync(new URL('./fixtures/forced-win-default-path.json', import.meta.url), JSON.stringify(recorded, null, 1) + '\n');
        return;
      }
      expect(actual).toEqual(recorded[name]);
    });
  });
});

interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: TeraAllowance;
  sleepClause: boolean;
  ruleset?: StaticRuleset;
  side: 'p1' | 'p2';
  rootOrder: string[];
}
const scene = (name: string, folder: 'forced-win' | 'positions' = 'forced-win') =>
  JSON.parse(readFileSync(new URL(`./fixtures/${folder}/${name}.json`, import.meta.url), 'utf-8')) as Scene;

const prove = (board: Scene) =>
  proveForcedWin(board.serialized, { side: board.side, rootOrder: board.rootOrder ?? [], tera: board.tera ?? false, sleepClause: board.sleepClause, ruleset: board.ruleset });

describe('the forced-win proof without the greedy scout', () => {
  const misses: Array<[string, string, number]> = [
    ['Doubles OU 2661746817 turn 8', 'scout-miss-gen9doublesou-2661746817-t8', 1],
    ['VGC 2024 Reg G 2163312677 turn 8', 'scout-miss-gen9vgc2024regg-2163312677-t8', 1],
    ['Champions VGC 2682637901 turn 6 (Bo3)', 'scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 2],
  ];
  test.each(misses)('doubles, %s: the proof the scout missed reads mass 1', async (_title, name, turns) => {
    const board = scene(name);
    await loadSimMods(board.ruleset === 'champions' ? 'gen9championsdoublescustomgame' : 'gen9doublescustomgame');
    const proof = prove(board);
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(turns);
    expect(proof.caveat).toBe('sampled-rolls');
  });

  // Champions VGC 2694684816 turn 8: 36 of the 100 cells are unpriced faint splits and the production budget ends with no proof (mass 0).
  // Whether the win is certain by the game is open: the pricing of a split that follows a crit, and the class plan's read of slot a with one
  // body per side. The row turns red when either lands; the pin then moves to the proof it finds.
  test('doubles, Champions VGC 2694684816 turn 8: no proof within the production budget', async () => {
    const board = scene('scout-miss-gen9championsvgc2026regmc-2694684816-t8');
    await loadSimMods('gen9championsdoublescustomgame');
    expect(prove(board).mass).toBe(0);
  });

  test.each([
    ['smogtours-gen9ou-749351-t10', 'p1', 1, 'none'],
    ['smogtours-gen9ou-749828-t23', 'p2', 1, 'barring-crit'],
  ] as const)('singles, %s: the proof for %s stays mass 1 in %i turn', (name, side, turns, caveat) => {
    const proof = prove({ ...scene(name, 'positions'), side, rootOrder: [] });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(turns);
    expect(proof.caveat).toBe(caveat);
  });
});

describe('forced-win-doubles-replies', () => {
  interface Scene {
    id: string;
    turn: number;
    serialized: string;
    tera: TeraAllowance;
    sleepClause: boolean;
    side: 'p1' | 'p2';
    rootOrder: string[];
  }

  const scene = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Scene;

  const SEEDS: PRNGSeed[] = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

  function p1WinsThisTurn(serialized: string, choice: string, reply: string): number {
    return SEEDS.filter(seed => {
      const battle = deserializeBattleExact(serialized);
      battle.prng = new PRNG(seed);
      battle.choose('p1', choice);
      battle.choose('p2', reply);
      return battle.ended && battle.winner === battle.sides[0].name;
    }).length;
  }

  function makeSet(name: string, species: string, moves: string[]): PokemonSet {
    return {
      name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: '',
    };
  }

  function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid: string): Battle {
    const battle = new Battle({
      formatid: toID(formatid),
      seed: [1, 2, 3, 4],
      p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
      p2: { name: 'Beta', team: Teams.pack(p2Sets) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
      battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
    }
    return battle;
  }

  /** Two Machamp tossing two 1-HP Chansey, each Chansey with three single-target attacks: 36 legal p2 combos, no escape. */
  function tossPair(): string {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Champ2', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Pound', 'Scratch', 'Tackle']), makeSet('Egg2', 'Chansey', ['Pound', 'Scratch', 'Tackle'])],
      'gen9doublescustomgame',
    );
    for (const mon of battle.sides[1].pokemon) mon.hp = 1;
    return JSON.stringify(State.serializeBattle(battle));
  }

  describe('forced-win prover: every reply of the defending side', () => {
    test('doubles, VGC 2630685175 turn 7: the Wood Hammer and Earth Power line proves nothing, since Zamazenta\'s Protect escapes it', () => {
      const board = scene('gen9vgc2026regi-2630685175-t7');
      const root = createRootPosition(board.serialized);
      const replies = legalChoices(root, 'p2', { tera: board.tera });
      expect(replies).toHaveLength(36);
      const line = 'move woodhammer 1, move earthpower 2';
      expect(board.rootOrder[0]).toBe(line);
      // The simulator: Wood Hammer takes Calyrex-Shadow, Earth Power hits Zamazenta's Protect, and the game goes on.
      const protect = replies.find(reply => reply.label === 'Astral Barrage + Protect');
      expect(protect).toBeDefined();
      expect(p1WinsThisTurn(board.serialized, line, protect!.choice)).toBe(0);
      // The full proof runs for the three ranked lines against every legal reply, and Zamazenta's Protect escapes each of them, so the proof
      // holds no mass.
      const proof = proveForcedWin(root, { side: 'p1', rootOrder: board.rootOrder, tera: board.tera, sleepClause: board.sleepClause });
      expect(proof.mass).toBe(0);
    });

    test('doubles, 2660809089 turn 8: Knock Off and Heat Wave prove nothing against the 42 legal replies', () => {
      const board = scene('gen9doublesou-2660809089-t8');
      const root = createRootPosition(board.serialized);
      const replies = legalChoices(root, 'p1', { tera: board.tera });
      expect(replies).toHaveLength(42);
      const request = { side: 'p2' as const, rootOrder: board.rootOrder, tera: board.tera, sleepClause: board.sleepClause };
      expect(board.rootOrder[0]).toBe('move knockoff 1, move heatwave');
      const proof = proveForcedWin(root, request);
      expect(proof.mass).toBe(0);
      expect(proof.cells).toBeGreaterThanOrEqual(replies.length);
    });

    test('doubles: a one-turn win proves against every legal reply, and the cell budget counts them all', () => {
      const serialized = tossPair();
      const replies = legalChoices(createRootPosition(serialized), 'p2', { tera: false });
      expect(replies).toHaveLength(36);
      const request = { side: 'p1' as const, rootOrder: ['move seismictoss 1, move seismictoss 2'], tera: false };
      const proof = proveForcedWin(serialized, request);
      expect(proof.mass).toBe(1);
      expect(proof.turns).toBe(1);
      expect(proof.cells).toBeGreaterThanOrEqual(replies.length);
      // What does not fit the budget proves nothing: 30 cells hold the tree's 12 combos, not the 36 legal replies.
      expect(proveForcedWin(serialized, { ...request, budget: { cells: 30 } }).mass).toBeLessThan(MIN_FORCED_MASS);
    });

    test('singles: the defender keeps the engine\'s list, so a Stealth Rock that fails into standing rocks draws no cell', () => {
      const battle = makeBattle(
        [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
        [makeSet('Egg', 'Chansey', ['Splash', 'Stealth Rock'])],
        'gen9customgame',
      );
      battle.sides[0].addSideCondition('stealthrock', 'debug');
      battle.sides[1].pokemon[0].hp = 1;
      const serialized = JSON.stringify(State.serializeBattle(battle));
      expect(legalChoices(createRootPosition(serialized), 'p2', { tera: false })).toHaveLength(2);
      const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
      expect(proof.mass).toBe(1);
      expect(proof.cells).toBe(1);
    });
  });
});

describe('plain-dice-scenes', () => {
  // Saved roots of corpus games (`fixtures/forced-win/plain-dice-*`) and #145's singles scene: a cell whose draws agree on who faints but a die decides is priced by one child per turned die with the simulator's own chance, 33 in 100 for the confusion self-hit and one in three for a second Protect.
  interface Scene {
    id: string;
    turn: number;
    serialized: string;
    tera: TeraAllowance;
    sleepClause: boolean;
    ruleset: StaticRuleset;
    side: 'p1' | 'p2';
    rootOrder: string[];
    p1Won: boolean;
  }
  const scene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/forced-win/plain-dice-${name}.json`, import.meta.url), 'utf-8')) as Scene;

  function alone(board: Scene) {
    const root = createRootPosition(board.serialized, board.ruleset);
    const prover = new Prover(board.side, { tera: board.tera, sleepClause: board.sleepClause, ruleset: board.ruleset }, { ...PROVER_BUDGET }, { states: 0, cells: 0 });
    prover.states += 1;
    const { proven, cells } = prover.expand(root, 0, board.rootOrder);
    return { proven, cells };
  }

  describe('the lost-side proof of VGC 2408473310 turn 13 (the confusion self-hit)', () => {
    test('Miraidon hits itself one time in three: the root cell has that child, the proof reads below 1 and at most 0.80', async () => {
      const board = scene('gen9vgc2025regi-2408473310-t13');
      await loadSimMods('gen9doublescustomgame');
      const root = createRootPosition(board.serialized, board.ruleset);
      const cell = endgameChildren(root, 'move dracometeor 2', 'move protect', 6);
      expect(cell.plain).toBe(true);
      expect(cell.children.map(child => child.share).sort((a, b) => a - b)).toEqual([expect.closeTo(0.33, 12), expect.closeTo(0.67, 12)]);
      const proof = proveForcedWin(board.serialized, { side: board.side, rootOrder: board.rootOrder, tera: board.tera, sleepClause: board.sleepClause, ruleset: board.ruleset });
      expect(proof.mass).toBeLessThan(1);
      expect(proof.mass).toBeLessThanOrEqual(0.8);
      expect(proof.mass).toBeGreaterThan(0.5);
    });
  });

  describe('a repeated Protect is priced at the proving move (doubles)', () => {
    // the proving move alone: the hold the draws all failed is one third, so no turn proves the win in one turn
    test.each([
      ['Champions VGC 2679549596 turn 7', 'gen9championsvgc2026regmbbo3-2679549596-t7', 'gen9championsdoublescustomgame'],
      ['VGC 2468711188 turn 7', 'gen9vgc2025regj-2468711188-t7', 'gen9doublescustomgame'],
      ['VGC 2532538236 turn 7', 'gen9vgc2026regi-2532538236-t7', 'gen9doublescustomgame'],
    ])('%s: the proof is no longer a one-turn proof', async (_title, name, mod) => {
      const board = scene(name);
      await loadSimMods(mod);
      const { proven } = alone(board);
      expect(proven.turns, `${name} turns`).toBeGreaterThan(1);
    });

    test('the cell of the Detect against Rock Blast splits two thirds and one third', async () => {
      const board = scene('gen9vgc2025regj-2468711188-t7');
      await loadSimMods('gen9doublescustomgame');
      const { cells } = alone(board);
      const worst = cells.find(cell => cell.proven.mass < 1)?.cell;
      const shares = (worst?.children ?? []).map(child => child.share);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
      expect(shares.some(share => Math.abs(share - 1 / 3) < 1e-9)).toBe(true);
    });
  });

  describe('singles scene: a second Spiky Shield holds one time in three', () => {
    // Chesnaught at 1 HP behind a Protect counter of 1 against a Garchomp that needs one more hit: the shield holds with the chance
    // the counter gives, and the game decides the rest. The sweep proves the share for every stalling move of every rule set.
    test.each([
      ['Scarlet/Violet', 'gen9customgame', 'standard', 100, undefined],
      ['Champions', 'gen9championscustomgame', 'champions', 50, { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 }],
    ] as const)('%s: the cell has a child of 2/3 and one of 1/3, the proof reads 2/3', async (_title, format, ruleset, level, evs) => {
      await loadSimMods('gen9championsou');
      const extra = { level, ...(evs ? { evs } : {}) };
      const battle = battleOf(format, [set('Chesnaught', ['spikyshield', 'woodhammer'], extra)], [set('Garchomp', ['dragonclaw'], extra)]);
      const chesnaught = battle.sides[0].active[0]!;
      const garchomp = battle.sides[1].active[0]!;
      chesnaught.hp = 1;
      garchomp.hp = Math.max(1, Math.floor(garchomp.maxhp / 8) - 1);
      chesnaught.addVolatile('stall');
      const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), ruleset);
      const cell = endgameChildren(root, 'move spikyshield', 'move dragonclaw', 6);
      expect(cell.plain).toBe(true);
      expect(cell.unpriced).toBe(false);
      expect(cell.children.map(child => child.share).sort((a, b) => a - b)).toEqual([expect.closeTo(1 / 3, 12), expect.closeTo(2 / 3, 12)]);
      expect(positionBattle(root).gameType).toBe('singles');
      const proof = proveForcedWin(root, { side: 'p2', rootOrder: [], tera: false });
      expect(proof.mass).toBeCloseTo(2 / 3, 9);
    });
  });

  describe('the tie path: each order plays apart and prices its dice (doubles)', () => {
    // Snorlax against Snorlax at one speed in the leading slots: the order is a coin flip (a child of one half each), and the confusion
    // of the first one decides inside each order (the self-hit, `randomChance(33, 100)`). Nobody faints, so the draws agree on the faints.
    test('two orders of one half, the self-hit splits 33 to 67 inside each', async () => {
      await loadSimMods('gen9championsou');
      const slow = { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
      const battle = battleOf(
        'gen9doublescustomgame', [set('Snorlax', ['tackle'], slow), set('Blissey', ['splash'])], [set('Snorlax', ['tackle'], slow), set('Chansey', ['splash'])],
      );
      battle.sides[0].active[0]!.addVolatile('confusion');
      const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
      const cell = endgameChildren(root, 'move tackle 1, move splash', 'move tackle 1, move splash', 6);
      expect(cell.plain).toBe(true);
      expect(cell.unpriced).toBe(false);
      const shares = cell.children.map(child => child.share).sort((a, b) => a - b);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
      expect(shares).toEqual([0.165, 0.165, 0.335, 0.335].map(share => expect.closeTo(share, 12)));
    });
  });
});
