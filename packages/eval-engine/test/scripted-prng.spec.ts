import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID, PRNG, type PokemonSet } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, positionBattle } from '../src/forward-model';
import type { RollScripts } from '../src/forward/scripted-prng';
import { loadSimMods } from '../src/forward/sim-mods';
import { ScriptedPRNG, type RollScript } from '../src/forward/scripted-prng';
import { PairPRNG, type PairScript } from '../src/pair/prng';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 43: the simulator's dice on demand. A scripted PRNG answers the
 * accuracy roll, the crit roll, the damage roll and the speed-tie order of
 * one named move; everything else rolls from the seed as before.
 */

function makeSet(name: string, species: string, moves: string[], spe = 0, level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe },
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

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));
const scripts = (entries: Record<string, RollScript>): RollScripts => new Map(Object.entries(entries));

const jolt = () => makeSet('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt']);
const champ = () => makeSet('Champ', 'Machamp', ['Close Combat']);
const singlesRoot = (formatid = 'gen9customgame') => createRootPosition(serialize(makeBattle(formatid, [jolt()], [champ()])));
const champHp = (child: { child: { serialized: string } }) => positionBattle(child.child).sides[1].pokemon[0].hp;

describe('scripted PRNG (round 43)', () => {
  test('forces a Thunder miss and a Thunder hit on every seed', () => {
    const root = singlesRoot();
    for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12'] as const) {
      const miss = advancePositionWithLog(root, 'move thunder', 'move closecombat', seed, { scripts: scripts({ 'p1:thunder': { hit: false } }) });
      expect(miss.log.some(line => line.startsWith('|-miss|p1a: Jolt'))).toBe(true);
      const hit = advancePositionWithLog(root, 'move thunder', 'move closecombat', seed, { scripts: scripts({ 'p1:thunder': { hit: true } }) });
      expect(hit.log.some(line => line.startsWith('|-miss|p1a: Jolt'))).toBe(false);
      expect(hit.log.some(line => line.startsWith('|-damage|p2a: Champ'))).toBe(true);
    }
  });

  test('forces the damage roll (0 = maximum, 15 = minimum) and the crit', () => {
    const root = singlesRoot();
    const at = (roll: number, crit: boolean) => advancePositionWithLog(root, 'move thunderbolt', 'move closecombat', '1,2,3,4',
      { scripts: scripts({ 'p1:thunderbolt': { hit: true, crit, roll } }) });
    const max = at(0, false);
    const min = at(15, false);
    const critMax = at(0, true);
    expect(max.log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(false);
    expect(critMax.log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(true);
    const maxHp = positionBattle(root).sides[1].pokemon[0].maxhp;
    const ratio = (maxHp - champHp(min)) / (maxHp - champHp(max));
    expect(ratio).toBeGreaterThan(0.83);
    expect(ratio).toBeLessThan(0.87);
    expect(champHp(critMax)).toBeLessThan(champHp(max));
    // Deterministic: the same script twice is the same child.
    expect(at(7, false).child.serialized).toBe(at(7, false).child.serialized);
  });

  test('gen 6: the crit denominator 16 is not mistaken for the damage roll', () => {
    const root = singlesRoot('gen6customgame');
    const at = (roll: number, crit: boolean) => advancePositionWithLog(root, 'move thunderbolt', 'move closecombat', '1,2,3,4',
      { scripts: scripts({ 'p1:thunderbolt': { hit: true, crit, roll } }) });
    expect(at(15, true).log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(true);
    expect(at(0, false).log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(false);
    expect(champHp(at(15, false))).toBeGreaterThan(champHp(at(0, false)));
  });

  test('forces the speed-tie order both ways', () => {
    const root = createRootPosition(serialize(makeBattle('gen9customgame',
      [makeSet('Alpha', 'Jolteon', ['Thunderbolt'], 252)], [makeSet('Beta', 'Jolteon', ['Thunderbolt'], 252)])));
    for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16'] as const) {
      for (const first of ['p1', 'p2'] as const) {
        const step = advancePositionWithLog(root, 'move thunderbolt', 'move thunderbolt', seed, { scripts: scripts({ 'p1:thunderbolt': { first } }) });
        const firstMove = step.log.find(line => line.startsWith('|move|'));
        expect(firstMove?.startsWith(`|move|${first}a:`)).toBe(true);
      }
    }
  });

  test('doubles: the named single-target move misses on demand while the partner rolls normally', () => {
    const root = createRootPosition(serialize(makeBattle('gen9doublescustomgame',
      [jolt(), makeSet('Lax', 'Snorlax', ['Body Slam'])],
      [champ(), makeSet('Chu', 'Pikachu', ['Tackle'], 0, 30)])));
    const step = advancePositionWithLog(root, 'move thunder 1, move bodyslam 1', 'move closecombat 1, move tackle 1', '1,2,3,4',
      { scripts: scripts({ 'p1:thunder': { hit: false } }) });
    expect(step.log.some(line => line.startsWith('|-miss|p1a: Jolt'))).toBe(true);
    expect(step.log.some(line => line.startsWith('|move|p1b: Lax|Body Slam'))).toBe(true);
  });

  test('without scripts the advance is byte-identical to the plain seed', () => {
    const root = singlesRoot();
    const plain = advancePositionWithLog(root, 'move thunder', 'move closecombat', '5,6,7,8');
    const empty = advancePositionWithLog(root, 'move thunder', 'move closecombat', '5,6,7,8', { scripts: new Map() });
    expect(empty.child.serialized).toBe(plain.child.serialized);
    expect(empty.log).toEqual(plain.log);
  });
});

await loadSimMods('gen9championsou');

const SEEDS = Array.from({ length: 32 }, (_, index) => [1, 2, 3, 4].map(offset => index * 4 + offset).join(','));

interface Rules { name: string; generation: number; singles: string; doubles: string | null; level: number; evs?: PokemonSet['evs'] }

const gen = (generation: number): Rules => ({
  name: `Gen ${generation}`, generation, singles: `gen${generation}customgame`,
  doubles: generation >= 3 ? `gen${generation}doublescustomgame` : null, level: 100,
});
const CHAMPIONS: Rules = {
  name: 'Champions', generation: 9, singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame', level: 50,
  evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 },
};
const RULES: Rules[] = [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen), CHAMPIONS];

const mon = (rules: Rules, species: string, moves: string[], gender: 'M' | 'F' | '' = ''): PokemonSet =>
  set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...(rules.generation >= 2 ? { gender } : {}) });

/** Snorlax of p1 tackles Pikachu of p2, which splashes. */
const singlesBoard = (rules: Rules, seed: string): Battle =>
  battleOf(rules.singles, [mon(rules, 'Snorlax', ['tackle'], 'M')], [mon(rules, 'Pikachu', ['splash'], 'F')], seed);

/** The same pair in front, Blissey and Chansey beside them splash. */
const doublesBoard = (rules: Rules, seed: string): Battle =>
  battleOf(rules.doubles!,
    [mon(rules, 'Snorlax', ['tackle'], 'M'), mon(rules, 'Blissey', ['splash'], 'F')],
    [mon(rules, 'Pikachu', ['splash'], 'F'), mon(rules, 'Chansey', ['splash'], 'F')], seed);

const SINGLES_TURN = ['move 1', 'move 1'] as const;
const DOUBLES_TURN = ['move 1 1, move 1', 'move 1, move 1'] as const;

interface Dice extends PRNG { attach?(battle: Battle): void }

/** Puts the dice on the board, starts the condition, plays one turn. */
function play(board: Battle, dice: Dice, start: ((battle: Battle) => void) | null, [p1, p2]: readonly [string, string]): Battle {
  dice.attach?.(board);
  board.prng = dice;
  start?.(board);
  if (!board.choose('p1', p1) || !board.choose('p2', p2)) throw new Error(`choice refused: "${p1}" / "${p2}"`);
  return board;
}

const shown = (pattern: RegExp) => (log: readonly string[]): boolean => log.some(line => pattern.test(line));

interface Check {
  /** The first generation whose simulator draws this check. */
  from: number;
  /** Puts the condition on the attacker, p1's first active. */
  start(battle: Battle): void;
  /** The check went the way that stops or hurts the attacker this turn. */
  shows(log: readonly string[]): boolean;
}

const attacker = (battle: Battle) => battle.sides[0].active[0]!;
const started = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`${what} did not start`);
};

/** The checks the simulator draws in the attacker's own action (the dice `|cant|` reasons of pair-cant-reasons.spec.ts and the confusion self-hit). */
const CHECKS: Record<string, Check> = {
  'full paralysis': {
    from: 1, start: battle => started(attacker(battle).setStatus('par'), 'paralysis'), shows: shown(/^\|cant\|p1a: Snorlax\|par/),
  },
  thaw: {
    from: 2, start: battle => started(attacker(battle).setStatus('frz'), 'freeze'), shows: shown(/^\|-curestatus\|p1a: Snorlax\|frz/),
  },
  infatuation: {
    from: 2,
    start: battle => started(attacker(battle).addVolatile('attract', battle.sides[1].active[0]!), 'infatuation'),
    shows: shown(/^\|cant\|p1a: Snorlax\|Attract/),
  },
  'confusion self-hit': {
    from: 1, start: battle => started(attacker(battle).addVolatile('confusion'), 'confusion'),
    shows: shown(/^\|-damage\|p1a: Snorlax\|[^|]*\|\[from\] confusion/),
  },
};

const checksOf = (rules: Rules) => Object.entries(CHECKS).filter(([, check]) => rules.generation >= check.from);

const SCRIPTS: Record<string, RollScript & PairScript> = {
  'hit and crit': { hit: true, crit: true },
  'miss, no crit': { hit: false, crit: false },
};

describe.each(RULES)('ScriptedPRNG, $name singles: the script decides the move and nothing else (T299)', rules => {
  for (const [name, check] of checksOf(rules)) {
    for (const [label, script] of Object.entries(SCRIPTS)) {
      test(`${name} under "${label}": every seed's check comes out as on the plain seed`, () => {
        const base = SEEDS.map(seed => check.shows(play(singlesBoard(rules, seed), new PRNG(seed), check.start, SINGLES_TURN).log));
        const ours = SEEDS.map(seed => check.shows(play(
          singlesBoard(rules, seed), new ScriptedPRNG(seed, new Map([['p1:tackle', script]])), check.start, SINGLES_TURN).log));
        expect(base.some(Boolean), `the plain seeds never show ${name}`).toBe(true);
        expect(SEEDS.filter((_, index) => ours[index] !== base[index]), 'seeds whose check the script decided').toEqual([]);
      });
    }
  }

  const reach: Record<string, { script: RollScript; holds(log: readonly string[]): boolean }> = {
    'a scripted miss misses': { script: { hit: false }, holds: shown(/^\|-miss\|p1a: Snorlax|^\|move\|p1a: Snorlax\|Tackle\|.*\[miss\]/) },
    'a scripted crit crits': { script: { hit: true, crit: true }, holds: shown(/^\|-crit\|p2a: Pikachu/) },
  };
  for (const [name, { script, holds }] of Object.entries(reach)) {
    test(`${name} on every seed`, () => {
      // Gens 1 and 2 draw no accuracy for a move of 100 percent (the draw is 255 in 256 and the simulator skips a sure one):
      // the row plays a move under 100 there, which Tackle is in those generations, so a script has a draw to answer.
      const accuracy = singlesBoard(rules, SEEDS[0]).dex.moves.get('tackle').accuracy;
      if (rules.generation <= 2) expect(accuracy, "Tackle's accuracy in this generation").toBeLessThan(100);
      const missed = SEEDS.filter(seed => !holds(play(singlesBoard(rules, seed), new ScriptedPRNG(seed, new Map([['p1:tackle', script]])), null, SINGLES_TURN).log));
      expect(missed, 'seeds the script did not reach').toEqual([]);
    });
  }

  test('the top roll hurts more than the bottom roll on every seed', () => {
    const damage = (seed: string, roll: number): number => {
      const battle = play(singlesBoard(rules, seed), new ScriptedPRNG(seed, new Map([['p1:tackle', { hit: true, crit: false, roll }]])), null, SINGLES_TURN);
      const target = battle.sides[1].active[0]!;
      return target.maxhp - target.hp;
    };
    expect(SEEDS.filter(seed => damage(seed, 0) <= damage(seed, 15)), 'seeds where the roll did not move the damage').toEqual([]);
  });

  test('a confusion self-hit keeps the damage roll of the plain seed', () => {
    const confusion = CHECKS['confusion self-hit'];
    /** The HP the self-hit took, or null on a seed without one. */
    const selfHit = (seed: string, dice: Dice): number | null => {
      const battle = play(singlesBoard(rules, seed), dice, confusion.start, SINGLES_TURN);
      return confusion.shows(battle.log) ? attacker(battle).maxhp - attacker(battle).hp : null;
    };
    const hits = SEEDS.map(seed => [seed, selfHit(seed, new PRNG(seed))] as const);
    expect(hits.some(([, hp]) => hp !== null), 'the plain seeds never show a self-hit').toBe(true);
    const differ = hits.filter(([seed, hp]) => selfHit(seed, new ScriptedPRNG(seed, new Map([['p1:tackle', { roll: 15 }]]))) !== hp);
    expect(differ.map(([seed]) => seed), 'seeds whose self-hit took the script\'s roll').toEqual([]);
  });
});

describe.each(RULES.filter(rules => rules.doubles !== null))('PairPRNG, $name doubles: the records hold the move and nothing else (T299)', rules => {
  for (const [name, check] of checksOf(rules)) {
    for (const [label, script] of Object.entries(SCRIPTS)) {
      test(`${name} under "${label}": every seed's check comes out as on the plain seed`, () => {
        const base = SEEDS.map(seed => check.shows(play(doublesBoard(rules, seed), new PRNG(seed), check.start, DOUBLES_TURN).log));
        const ours = SEEDS.map(seed => check.shows(play(
          doublesBoard(rules, seed), new PairPRNG(seed, new Map([['p1a:tackle>p2a', script]])), check.start, DOUBLES_TURN).log));
        expect(base.some(Boolean), `the plain seeds never show ${name}`).toBe(true);
        expect(SEEDS.filter((_, index) => ours[index] !== base[index]), 'seeds whose check the script decided').toEqual([]);
      });
    }
  }

  const confused = (seed: string): { battle: Battle; dice: PairPRNG } => {
    const dice = new PairPRNG(seed);
    return { battle: play(doublesBoard(rules, seed), dice, CHECKS['confusion self-hit'].start, DOUBLES_TURN), dice };
  };

  test('a confused attacker\'s accuracy records carry the move\'s accuracy', () => {
    const wrong = SEEDS.flatMap(seed => {
      const { battle, dice } = confused(seed);
      const accuracy = battle.dex.moves.get('tackle').accuracy;
      return dice.records.filter(record => record.kind === 'accuracy' && record.numerator !== accuracy)
        .map(record => `${seed}: ${record.key} ${record.kind === 'accuracy' ? record.numerator : ''}`);
    });
    expect(wrong, 'accuracy records of another draw').toEqual([]);
  });

  test('a turn the attacker spends hitting itself leaves no damage roll record of its move', () => {
    const selfHits = SEEDS.map(seed => [seed, confused(seed)] as const)
      .filter(([, { battle }]) => CHECKS['confusion self-hit'].shows(battle.log));
    expect(selfHits.length, 'the plain seeds never show a self-hit').toBeGreaterThan(0);
    const wrong = selfHits.flatMap(([seed, { dice }]) => dice.records
      .filter(record => record.kind === 'roll' && record.key.startsWith('p1a:tackle>')).map(record => `${seed}: ${record.key}`));
    expect(wrong, 'roll records of the self-hit').toEqual([]);
  });
});
