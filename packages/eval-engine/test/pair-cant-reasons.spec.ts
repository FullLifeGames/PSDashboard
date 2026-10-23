import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { CHANCE_CANT, diceEventTurns } from '../src/dice-events';
import { randomDeviation } from '../src/pair/log';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 70 (N1): the pair plan reads a draw's own lines, and `randomDeviation` sends a draw to the plain mean when a `|cant|`
 * line shows a dice outcome the plan does not price. The set it read held 'attract', but the simulator writes the
 * infatuation by the name of its condition, `|cant|p1a: Blissey|Attract`, so a real infatuation passed as a plain turn
 * (the reported scene below, seed 2). The reasons now come from the simulator: this census scans every `add('cant', ...)`
 * of @pkmn/sim (the data of every generation and its scripts) and of the Champions mod, names each reason it can write as
 * dice (the simulator draws a number this turn to decide it) or fixed (the position decides it), plays every reason in a
 * small doubles scene over 40 seeds (a dice reason shows on some seeds and not on others, a fixed one on every seed), and
 * holds `randomDeviation` to the same split. A reason the simulator adds or renames fails the census until someone
 * classifies it.
 */

await loadSimMods('gen9championsou');
const require = createRequire(import.meta.url);

function jsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

/** The simulator's CommonJS build (its data of every generation and its scripts) and the Champions mod's bundle. */
const SOURCES = [...jsFiles(join(dirname(require.resolve('@pkmn/sim')), '..')), require.resolve('@pkmn/mods/champions')];
/** Every write of a `|cant|` line, and the writes whose reason (the third argument) is a plain string. */
const ANY_WRITE = /\.add\(\s*(['"])cant\1/g;
const PLAIN_REASON = /\.add\(\s*(['"])cant\1\s*,\s*[^,()]+,\s*(['"])((?:(?!\2)[^\\]|\\.)*)\2/g;

function scan(): { writes: number; plain: number; reasons: string[] } {
  let writes = 0;
  let plain = 0;
  const reasons = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(file, 'utf8');
    writes += [...text.matchAll(ANY_WRITE)].length;
    for (const match of text.matchAll(PLAIN_REASON)) {
      plain++;
      reasons.add(match[3]);
    }
  }
  return { writes, plain, reasons: [...reasons].sort() };
}

/** `dice`: the simulator draws a number this turn to decide the reason. Fixed: the position decides it. */
const REASONS: Record<string, { dice: boolean; why: string }> = {
  par: { dice: true, why: 'the simulator draws full paralysis each time the body moves, 1 in 4 (1 in 8 in the Champions mod)' },
  frz: { dice: true, why: 'the simulator draws the thaw each time the body moves (Gen 1 freezes for good, and Gen 1 has no doubles format)' },
  flinch: { dice: true, why: 'a faster move set the flinch with a secondary chance drawn this turn' },
  Attract: { dice: true, why: 'the simulator flips a coin each time the infatuated body moves' },
  slp: { dice: false, why: 'the sleep length is drawn when the status starts, and every move attempt only counts it down' },
  recharge: { dice: false, why: 'the volatile the last turn left' },
  partiallytrapped: { dice: false, why: 'Gen 1 only: the trap length is drawn when the trap starts' },
  Disable: { dice: false, why: 'a move chosen before the disabling move landed' },
  nopp: { dice: false, why: 'the move had no PP left when its turn came (Spite took the last of it)' },
  'Focus Punch': { dice: false, why: 'the user was hit earlier this turn, a hit the plan reads as an event of its own' },
  'Shell Trap': { dice: false, why: 'no physical hit reached the user earlier this turn' },
  'move: Taunt': { dice: false, why: 'a status move chosen before the Taunt landed' },
  'move: Imprison': { dice: false, why: 'a move the Imprison user shares' },
  'move: Gravity': { dice: false, why: 'a move Gravity bans' },
  'move: Heal Block': { dice: false, why: 'a healing move under Heal Block' },
  'move: Throat Chop': { dice: false, why: 'a sound move after Throat Chop' },
  'ability: Truant': { dice: false, why: 'the loafing turn after a move' },
  'ability: Armor Tail': { dice: false, why: 'a priority move aimed at the holder\'s side' },
  'ability: Dazzling': { dice: false, why: 'a priority move aimed at the holder\'s side' },
  'ability: Queenly Majesty': { dice: false, why: 'a priority move aimed at the holder\'s side' },
  'ability: Damp': { dice: false, why: 'a self-destructing move while a Damp holder is on the field' },
};

describe('the |cant| reasons of the simulator, scanned (round 70, N1)', () => {
  const found = scan();

  test('every write has a plain reason, and the census names exactly the reasons the simulator writes', () => {
    expect(found.writes).toBeGreaterThan(80);
    expect(found.plain).toBe(found.writes);
    expect(found.reasons).toEqual(Object.keys(REASONS).sort());
  });

  test('randomDeviation reads the dice reasons and none of the fixed ones', () => {
    for (const [reason, kind] of Object.entries(REASONS)) {
      expect(`${reason} ${randomDeviation([`|cant|p1a: Snorlax|${reason}`])}`, kind.why).toBe(`${reason} ${kind.dice ? `cant:${reason}` : null}`);
    }
  });

  // Round 76 (T233): the report's dice markers read the same census: a dice reason is a dice event (sleep stays the documented
  // over-inclusion: the sleep length is drawn at the start, but a sleeping turn has always read as a roll in the luck claims).
  test('diceEventTurns and the sack scan (CHANCE_CANT) read every dice reason, and the pair plan reads the same set without sleep', () => {
    for (const [reason, kind] of Object.entries(REASONS)) {
      const marked = diceEventTurns([[], [`|cant|p1a: Snorlax|${reason}`]]).has(1);
      expect(`${reason} ${marked}`, kind.why).toBe(`${reason} ${kind.dice || reason === 'slp'}`);
    }
    const census = Object.entries(REASONS).filter(([reason, kind]) => kind.dice || reason === 'slp').map(([reason]) => reason);
    expect([...CHANCE_CANT].sort()).toEqual(census.sort());
    expect([...CHANCE_CANT].filter(reason => reason !== 'slp').every(reason => randomDeviation([`|cant|p1a: Snorlax|${reason}`]) === `cant:${reason}`)).toBe(true);
  });

  test('the reported scene: Snorlax\'s Attract on Blissey, seed 2 of the probe', () => {
    const evs = { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const battle = battleOf('gen9customgame', [set('Blissey', ['tackle'], { gender: 'F', evs })], [set('Snorlax', ['attract', 'tackle'], { gender: 'M' })], '2,2,3,4');
    for (const [p1, p2] of [['move 1', 'move 1'], ['move 1', 'move 2']]) {
      battle.choose('p1', p1);
      battle.choose('p2', p2);
    }
    expect(battle.log.filter(line => line.startsWith('|cant|'))).toEqual(['|cant|p1a: Blissey|Attract']);
    expect(randomDeviation(battle.log)).toBe('cant:Attract');
  });
});

interface Rules { name: string; format: string; level: number; evs?: PokemonSet['evs'] }

const SEEDS = Array.from({ length: 40 }, (_, index) => [1, 2, 3, 4].map(offset => index * 4 + offset).join(','));
const gen = (generation: number): Rules => ({ name: `Gen ${generation} doubles`, format: `gen${generation}doublescustomgame`, level: 100 });
const CHAMPIONS: Rules = {
  name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 },
};

/** Snorlax (slow) and Blissey of p1 against Pikachu (fast) and Chansey of p2: the victim in front of p1, the actor in front of p2. */
function board(rules: Rules, seed: string, victim: string[], actor: string[], extra: { victim?: Partial<PokemonSet>; actor?: Partial<PokemonSet> } = {}): Battle {
  const mon = (species: string, moves: string[], more: Partial<PokemonSet> = {}): PokemonSet =>
    set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...more });
  return battleOf(rules.format,
    [mon('Snorlax', victim, { gender: 'M', ...extra.victim }), mon('Blissey', ['splash'])],
    [mon('Pikachu', actor, { gender: 'F', ...extra.actor }), mon('Chansey', ['splash'])], seed);
}

function turn(battle: Battle, p1: string, p2: string): Battle {
  if (!battle.choose('p1', p1) || !battle.choose('p2', p2)) throw new Error(`choice refused: p1 "${p1}", p2 "${p2}"`);
  return battle;
}

const AT_FOE = 'move 1 1, move 1';
const PLAIN = 'move 1, move 1';

/** One scene per reason: the cause is set up so that the reason is what the first (or second) turn writes. */
const SCENES: Record<string, (rules: Rules, seed: string) => Battle> = {
  par: (rules, seed) => {
    const battle = board(rules, seed, ['tackle'], ['splash']);
    battle.sides[0].active[0]!.setStatus('par');
    return turn(battle, AT_FOE, PLAIN);
  },
  frz: (rules, seed) => {
    const battle = board(rules, seed, ['tackle'], ['splash']);
    battle.sides[0].active[0]!.setStatus('frz');
    return turn(battle, AT_FOE, PLAIN);
  },
  slp: (rules, seed) => {
    const battle = board(rules, seed, ['tackle'], ['splash']);
    battle.sides[0].active[0]!.setStatus('slp');
    return turn(battle, AT_FOE, PLAIN);
  },
  flinch: (rules, seed) => turn(board(rules, seed, ['tackle'], ['bite']), AT_FOE, AT_FOE),
  Attract: (rules, seed) => turn(board(rules, seed, ['tackle'], ['attract']), AT_FOE, AT_FOE),
  recharge: (rules, seed) => {
    const battle = board(rules, seed, ['hyperbeam', 'tackle'], ['splash']);
    battle.sides[0].active[0]!.addVolatile('mustrecharge');
    return turn(battle, PLAIN, PLAIN);
  },
  Disable: (rules, seed) => {
    const battle = turn(board(rules, seed, ['tackle'], ['disable', 'splash']), AT_FOE, 'move 2, move 1');
    return turn(battle, AT_FOE, AT_FOE);
  },
  nopp: (rules, seed) => {
    const battle = turn(board(rules, seed, ['tackle'], ['spite', 'splash']), AT_FOE, 'move 2, move 1');
    battle.sides[0].active[0]!.moveSlots[0].pp = 3;
    return turn(battle, AT_FOE, AT_FOE);
  },
  'Focus Punch': (rules, seed) => turn(board(rules, seed, ['focuspunch'], ['tackle']), AT_FOE, AT_FOE),
  'Shell Trap': (rules, seed) => turn(board(rules, seed, ['shelltrap'], ['splash']), PLAIN, PLAIN),
  'move: Taunt': (rules, seed) => turn(board(rules, seed, ['splash'], ['taunt']), PLAIN, AT_FOE),
  'move: Imprison': (rules, seed) => turn(board(rules, seed, ['tackle'], ['imprison', 'tackle']), AT_FOE, PLAIN),
  'move: Gravity': (rules, seed) => turn(board(rules, seed, ['highjumpkick'], ['gravity']), AT_FOE, PLAIN),
  'move: Heal Block': (rules, seed) => turn(board(rules, seed, ['recover'], ['healblock']), PLAIN, PLAIN),
  'move: Throat Chop': (rules, seed) => turn(board(rules, seed, ['hypervoice'], ['throatchop']), PLAIN, AT_FOE),
  'ability: Truant': (rules, seed) => {
    const battle = turn(board(rules, seed, ['tackle'], ['splash'], { victim: { ability: 'Truant' } }), AT_FOE, PLAIN);
    return turn(battle, AT_FOE, PLAIN);
  },
  'ability: Armor Tail': (rules, seed) => turn(board(rules, seed, ['quickattack'], ['splash'], { actor: { species: 'Farigiraf', ability: 'Armor Tail' } }), AT_FOE, PLAIN),
  'ability: Dazzling': (rules, seed) => turn(board(rules, seed, ['quickattack'], ['splash'], { actor: { species: 'Bruxish', ability: 'Dazzling' } }), AT_FOE, PLAIN),
  'ability: Queenly Majesty': (rules, seed) => turn(board(rules, seed, ['quickattack'], ['splash'], { actor: { species: 'Tsareena', ability: 'Queenly Majesty' } }), AT_FOE, PLAIN),
  'ability: Damp': (rules, seed) => turn(board(rules, seed, ['explosion'], ['splash'], { actor: { species: 'Politoed', ability: 'Damp' } }), PLAIN, PLAIN),
};

const reasonsOf = (battle: Battle): string[] => battle.log.filter(line => line.startsWith('|cant|')).map(line => line.split('|')[3]);

/** The scenes of the reasons the rule sets can host: the dice reasons in every doubles generation the simulator has, the fixed ones in the two rule sets of the corpus. */
const RULE_SETS: { rules: Rules; reasons: string[] }[] = [
  ...[3, 4, 5, 6, 7, 8].map(generation => ({ rules: gen(generation), reasons: ['par', 'frz', 'flinch', 'Attract', 'slp'] })),
  { rules: gen(9), reasons: Object.keys(SCENES) },
  { rules: CHAMPIONS, reasons: Object.keys(SCENES) },
];

describe.each(RULE_SETS)('$rules.name: every reason played over 40 seeds (round 70, N1)', ({ rules, reasons }) => {
  test.each(reasons)('%s', reason => {
    const kind = REASONS[reason];
    const battles = SEEDS.map(seed => SCENES[reason](rules, seed));
    const shown = battles.map(battle => reasonsOf(battle).includes(reason));
    expect(shown.some(Boolean), `${reason} never shows (${kind.why})`).toBe(true);
    if (kind.dice) expect(shown.every(Boolean), `${reason} shows on every seed, so it is fixed (${kind.why})`).toBe(false);
    else expect(shown.every(Boolean), `${reason} is missing on some seeds, so it is dice (${kind.why})`).toBe(true);
    battles.forEach((battle, index) => {
      expect(randomDeviation(battle.log), `${reason}, seed ${SEEDS[index]}`).toBe(kind.dice && shown[index] ? `cant:${reason}` : null);
    });
  });
});

describe('Gen 1, the one reason the doubles generations never write (round 70, N1)', () => {
  test('partiallytrapped shows on every seed where the Wrap landed, and randomDeviation reads it as fixed', () => {
    const landed = SEEDS.map(seed => {
      const battle = battleOf('gen1customgame', [set('Snorlax', ['tackle'])], [set('Pikachu', ['wrap'])], seed);
      turn(battle, 'move 1', 'move 1');
      return battle;
    }).filter(battle => !battle.log.some(line => line.startsWith('|-miss|')));
    expect(landed.length).toBeGreaterThan(20);
    for (const battle of landed) {
      expect(reasonsOf(battle)).toContain('partiallytrapped');
      expect(randomDeviation(battle.log)).toBeNull();
    }
  });
});
