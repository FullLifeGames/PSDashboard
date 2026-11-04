import { describe, expect, test } from 'vitest';
import { PRNG, type Battle, type PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { ScriptedPRNG, type RollScript } from '../src/forward/scripted-prng';
import { PairPRNG, type PairScript } from '../src/pair/prng';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 82 (T299): a scripted die answers the draw of the move it scripts and leaves the attacker's status checks to the
 * seed. The simulator draws those checks inside the attacker's action, because `runMove` sets the active move before
 * `BeforeMove`: full paralysis (1 in 4; 63 in 256 in Gens 1 and 2; 1 in 8 in the Champions mod), the thaw (1 in 5; Gen 2
 * thaws at the end of the turn; 1 in 4 under the Champions timer), the infatuation (1 in 2) and the confusion self-hit
 * (1 in 2 up to Gen 6, 33 in 100 from Gen 7) with a damage roll of its own. `ScriptedPRNG` (the singles tree) reads the
 * first `randomChance(x, 100)` of a scripted move as its accuracy roll and any `randomChance(1, d)` with a crit denominator
 * as its crit roll, and answers the first `random(16)` of the action with the script's roll; `PairPRNG` (the doubles pair
 * plan) guards the crit with `inDamage()` but not the accuracy, and books every `random(16)` of the action as a roll of
 * the move. In Gens 1 and 2 accuracy and crit draw in 256ths and the damage roll is `random(217, 256)`, so a script
 * reaches none of them.
 *
 * The sweep plays every check in every generation and mod the corpus plays, singles for `ScriptedPRNG` and doubles for
 * `PairPRNG`, and compares each seed with the plain PRNG on the same seed. A row the code reads wrong today is a
 * `test.fails` in KNOWN: the day the fix lands, the row turns red and leaves the list.
 */

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

const BOTH = ['hit and crit', 'miss, no crit'];
const named = (prefix: string, rules: string[], rows: string[]): string[] => rules.flatMap(name => rows.map(entry => `${prefix} ${name} ${entry}`));
const FROM_GEN_3 = ['Gen 3', 'Gen 4', 'Gen 5', 'Gen 6', 'Gen 7', 'Gen 8', 'Gen 9', 'Champions'];
const FROM_GEN_7 = ['Gen 7', 'Gen 8', 'Gen 9', 'Champions'];

/** Rows the code reads wrong today (expected failures), by cause. */
const KNOWN: ReadonlySet<string> = new Set([
  // PairPRNG guards the crit with inDamage(), not the accuracy: the confusion check of Gen 7 on is read and booked as accuracy 33.
  ...named('pair', FROM_GEN_7, [...BOTH.map(label => `confusion self-hit ${label}`), 'accuracy record']),
  // The self-hit's random(16) books a roll of the move: on the attacker from Gen 7, on the move's own target before.
  ...named('pair', FROM_GEN_3, ['self-hit roll']),
]);

const row = (id: string) => (KNOWN.has(id) ? test.fails : test);

const SCRIPTS: Record<string, RollScript & PairScript> = {
  'hit and crit': { hit: true, crit: true },
  'miss, no crit': { hit: false, crit: false },
};

describe.each(RULES)('ScriptedPRNG, $name singles: the script decides the move and nothing else (T299)', rules => {
  for (const [name, check] of checksOf(rules)) {
    for (const [label, script] of Object.entries(SCRIPTS)) {
      const id = `scripted ${rules.name} ${name} ${label}`;
      row(id)(`${name} under "${label}": every seed's check comes out as on the plain seed`, () => {
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
    const id = `scripted ${rules.name} ${name}`;
    row(id)(`${name} on every seed`, () => {
      // Gens 1 and 2 draw no accuracy for a move of 100 percent (the draw is 255 in 256 and the simulator skips a sure one):
      // the row plays a move under 100 there, which Tackle is in those generations, so a script has a draw to answer.
      const accuracy = singlesBoard(rules, SEEDS[0]).dex.moves.get('tackle').accuracy;
      if (rules.generation <= 2) expect(accuracy, "Tackle's accuracy in this generation").toBeLessThan(100);
      const missed = SEEDS.filter(seed => !holds(play(singlesBoard(rules, seed), new ScriptedPRNG(seed, new Map([['p1:tackle', script]])), null, SINGLES_TURN).log));
      expect(missed, 'seeds the script did not reach').toEqual([]);
    });
  }

  row(`scripted ${rules.name} a scripted roll`)('the top roll hurts more than the bottom roll on every seed', () => {
    const damage = (seed: string, roll: number): number => {
      const battle = play(singlesBoard(rules, seed), new ScriptedPRNG(seed, new Map([['p1:tackle', { hit: true, crit: false, roll }]])), null, SINGLES_TURN);
      const target = battle.sides[1].active[0]!;
      return target.maxhp - target.hp;
    };
    expect(SEEDS.filter(seed => damage(seed, 0) <= damage(seed, 15)), 'seeds where the roll did not move the damage').toEqual([]);
  });

  row(`scripted ${rules.name} self-hit roll`)('a confusion self-hit keeps the damage roll of the plain seed', () => {
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
      const id = `pair ${rules.name} ${name} ${label}`;
      row(id)(`${name} under "${label}": every seed's check comes out as on the plain seed`, () => {
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

  row(`pair ${rules.name} accuracy record`)('a confused attacker\'s accuracy records carry the move\'s accuracy', () => {
    const wrong = SEEDS.flatMap(seed => {
      const { battle, dice } = confused(seed);
      const accuracy = battle.dex.moves.get('tackle').accuracy;
      return dice.records.filter(record => record.kind === 'accuracy' && record.numerator !== accuracy)
        .map(record => `${seed}: ${record.key} ${record.kind === 'accuracy' ? record.numerator : ''}`);
    });
    expect(wrong, 'accuracy records of another draw').toEqual([]);
  });

  row(`pair ${rules.name} self-hit roll`)('a turn the attacker spends hitting itself leaves no damage roll record of its move', () => {
    const selfHits = SEEDS.map(seed => [seed, confused(seed)] as const)
      .filter(([, { battle }]) => CHECKS['confusion self-hit'].shows(battle.log));
    expect(selfHits.length, 'the plain seeds never show a self-hit').toBeGreaterThan(0);
    const wrong = selfHits.flatMap(([seed, { dice }]) => dice.records
      .filter(record => record.kind === 'roll' && record.key.startsWith('p1a:tackle>')).map(record => `${seed}: ${record.key}`));
    expect(wrong, 'roll records of the self-hit').toEqual([]);
  });
});
