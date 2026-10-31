import { describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { answerDie } from '../src/dice/answer';
import { ForcedDicePRNG } from '../src/dice/prng';
import { genShape } from '../src/dice/recognize';
import type { DieName, Draw, ForcedDie } from '../src/dice/types';
import { dieKey } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import {
  boardOf, clicksOf, GRID_SCENES, PIKACHU, playClicks, RULES, seedOf, SNORLAX, stableLog, type Mode, type Rules, type Scene,
} from './dice-fixtures';

// Round 82 (forced dice), decision D4: how a die answers. A chance answers yes or no; a die with no way to give an answer
// keeps the natural result and says so; the damage roll's step runs from the lowest damage up in every generation; and a
// forced-dice PRNG with nothing forced plays byte for byte the plain PRNG.
await loadSimMods('gen9championsou');

const SEEDS = Array.from({ length: 12 }, (_, index) => seedOf(index));
const gameTypes = (rules: Rules): Mode[] => (rules.doubles ? ['singles', 'doubles'] : ['singles']);
const cases = RULES.flatMap(rules => gameTypes(rules).map(mode => ({ rules, mode })));

/** Plays the scene's turn with the module's PRNG over the battle's own and returns the PRNG and the battle. */
function forcedTurn(rules: Rules, scene: Scene, mode: Mode, seed: string, forced: ForcedDie[]) {
  const battle = boardOf(rules, scene, mode, seed)!;
  const inner = battle.prng;
  const watch = watchBattle(battle);
  const prng = new ForcedDicePRNG({ inner, watch, forced, record: new Map() });
  battle.prng = prng;
  try {
    playClicks(battle, clicksOf(scene, mode));
  } finally {
    watch.uninstall();
    battle.prng = inner;
  }
  return { battle, prng };
}

const kick = (kind: DieName['kind'], effectId?: string): DieName => ({ slot: 'p1a', moveId: 'megakick', targetSlot: 'p2a', kind, ...(effectId ? { effectId } : {}) });
const MEGA_KICK: Scene = { id: 'mega kick', a: SNORLAX(['megakick']), t: PIKACHU(['splash']) };
const TACKLE: Scene = { id: 'tackle', a: SNORLAX(['tackle']), t: PIKACHU(['splash']) };
const missLines = (battle: Battle): number => battle.log.filter(line => line.startsWith('|-miss|')).length;
const critLines = (battle: Battle): number => battle.log.filter(line => line.startsWith('|-crit|')).length;

describe('a chance draw answers yes or no', () => {
  const chance = (numerator: number, denominator: number): Draw => ({ call: 'chance', from: denominator, numerator });

  test('yes draws the lowest value, no the highest, and the PRNG reads them as the chance', () => {
    for (const [numerator, denominator] of [[75, 100], [191, 256], [1, 24], [1, 16], [254, 255]]) {
      const yes = answerDie('accuracy', { happens: true }, chance(numerator, denominator), 9);
      const no = answerDie('accuracy', { happens: false }, chance(numerator, denominator), 9);
      expect(yes).toEqual({ value: 0, chance: numerator / denominator });
      expect(no).toEqual({ value: denominator - 1, chance: numerator / denominator });
      // the simulator's own reading of the value, PRNG#randomChance: random(denominator) < numerator
      expect((yes as { value: number }).value < numerator).toBe(true);
      expect((no as { value: number }).value < numerator).toBe(false);
    }
  });

  test('a chance with no way to give the answer keeps the natural result and says so', () => {
    expect(answerDie('accuracy', { happens: true }, chance(0, 100), 9)).toEqual({ noChance: true, chance: 0 });
    expect(answerDie('accuracy', { happens: false }, chance(100, 100), 9)).toEqual({ noChance: true, chance: 1 });
    expect(answerDie('crit', { happens: false }, chance(5, 4), 9)).toEqual({ noChance: true, chance: 1.25 });
  });

  test('the Gen 2 crit compares a random(256): yes is 0, no is the top value', () => {
    const draw: Draw = { call: 'random', from: 256 };
    expect(answerDie('crit', { happens: true }, draw, 2)).toEqual({ value: 0 });
    expect(answerDie('crit', { happens: false }, draw, 2)).toEqual({ value: 255 });
  });

  test('a result that does not fit the kind is no answer', () => {
    expect(answerDie('accuracy', { step: 3 }, chance(75, 100), 9)).toBeNull();
    expect(answerDie('damage-roll', { happens: true }, { call: 'random', from: 16 }, 9)).toBeNull();
    expect(answerDie('damage-roll', { step: 16 }, { call: 'random', from: 16 }, 9)).toBeNull();
    expect(answerDie('damage-roll', { step: -1 }, { call: 'random', from: 16 }, 9)).toBeNull();
  });
});

describe.each(cases)('forced accuracy: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('yes lands every seed and no misses every seed, whatever the natural turn does', () => {
    let naturalMisses = 0;
    let naturalHits = 0;
    for (const seed of SEEDS) {
      const natural = boardOf(rules, MEGA_KICK, mode, seed)!;
      playClicks(natural, clicksOf(MEGA_KICK, mode));
      if (missLines(natural)) naturalMisses++;
      else naturalHits++;
      const yes = forcedTurn(rules, MEGA_KICK, mode, seed, [{ name: kick('accuracy'), result: { happens: true } }]);
      const no = forcedTurn(rules, MEGA_KICK, mode, seed, [{ name: kick('accuracy'), result: { happens: false } }]);
      expect(missLines(yes.battle), `yes ${seed}`).toBe(0);
      expect(yes.battle.log.some(line => line.startsWith('|-damage|p2a')), `yes ${seed} hurts`).toBe(true);
      expect(missLines(no.battle), `no ${seed}`).toBe(1);
      expect(yes.prng.notes.get(dieKey(kick('accuracy')))?.draws).toBe(1);
    }
    expect(naturalMisses, 'a seed misses by itself').toBeGreaterThan(0);
    expect(naturalHits, 'a seed hits by itself').toBeGreaterThan(0);
  });

  test('a 100 percent draw cannot be forced to miss: the turn keeps its hit and the note says no chance', () => {
    for (const seed of SEEDS) {
      const no = forcedTurn(rules, TACKLE, mode, seed, [{ name: { ...kick('accuracy'), moveId: 'tackle' }, result: { happens: false } }]);
      const note = no.prng.notes.get(dieKey({ ...kick('accuracy'), moveId: 'tackle' }));
      // Gen 2 turns a 100 percent move into accuracy 255 and draws nothing; Gens 5 and up draw chance(100, 100); the older ones draw below 100.
      if (!note) continue;
      expect(note.noChance, `${rules.name} ${seed}`).toBe(missLines(no.battle) === 0);
    }
  });
});

describe.each(cases)('forced crit: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('yes shows the crit line every seed, no shows none', () => {
    for (const seed of SEEDS) {
      const die = (happens: boolean): ForcedDie => ({ name: { ...kick('crit'), moveId: 'tackle' }, result: { happens } });
      const yes = forcedTurn(rules, TACKLE, mode, seed, [die(true)]);
      const no = forcedTurn(rules, TACKLE, mode, seed, [die(false)]);
      const missed = missLines(yes.battle) > 0;
      expect(critLines(yes.battle), `yes ${seed}`).toBe(missed ? 0 : 1);
      expect(critLines(no.battle), `no ${seed}`).toBe(0);
    }
  });
});

describe.each(cases)('the damage roll runs from the lowest damage up: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  const STRENGTH: Scene = { id: 'strength into Chansey', a: SNORLAX(['strength']), t: { species: 'Chansey', moves: ['splash'] } };
  const shape = genShape(rules.generation).roll;

  /**
   * The damage the target loses when the simulator draws this raw value for the roll: the turn plays with a PRNG that answers
   * the draws inside `battle.randomizer` (Gens 3 and up; a crit chance of 1 in 16 draws `random(16)` too) or the
   * `random(217, 256)` of Gens 1 and 2 with the raw value, and the stream for everything else.
   */
  const damageAtRaw = (seed: string, raw: number): number => {
    const battle = boardOf(rules, STRENGTH, mode, seed)!;
    const natural = battle.prng;
    let inRandomizer = false;
    const original = (battle as unknown as { randomizer(...args: unknown[]): unknown }).randomizer;
    (battle as unknown as { randomizer: unknown }).randomizer = function (this: unknown, ...args: unknown[]) {
      inRandomizer = true;
      try {
        return original.apply(this, args);
      } finally {
        inRandomizer = false;
      }
    };
    battle.prng = new (class extends PRNG {
      override random(from?: number, to?: number): number {
        const value = natural.random(from, to);
        const isRoll = shape.scope === 'randomizer' ? inRandomizer : from === shape.from && to === shape.to;
        return isRoll ? raw : value;
      }
    })(seed);
    playClicks(battle, clicksOf(STRENGTH, mode));
    return battle.sides[1].active[0].maxhp - battle.sides[1].active[0].hp;
  };

  test('step 0 deals the least damage of the raw values, the top step the most, and no step deals less than the one before', () => {
    // a seed whose turn hits without a crit: the roll is the only die that then moves the damage
    const seed = SEEDS.find(candidate => {
      const plain = boardOf(rules, STRENGTH, mode, candidate)!;
      playClicks(plain, clicksOf(STRENGTH, mode));
      return missLines(plain) === 0 && critLines(plain) === 0;
    })!;
    expect(seed).toBeDefined();
    const byRaw = Array.from({ length: shape.steps }, (_, index) => damageAtRaw(seed, shape.raw(index)));
    const least = Math.min(...byRaw);
    const most = Math.max(...byRaw);
    expect(most, 'the rolls differ').toBeGreaterThan(least);
    const byStep = Array.from({ length: shape.steps }, (_, step) => {
      const turn = forcedTurn(rules, STRENGTH, mode, seed, [{
        name: { slot: 'p1a', moveId: 'strength', targetSlot: 'p2a', kind: 'damage-roll' }, result: { step },
      }]);
      return turn.battle.sides[1].active[0].maxhp - turn.battle.sides[1].active[0].hp;
    });
    expect(byStep[0]).toBe(least);
    expect(byStep[shape.steps - 1]).toBe(most);
    for (let step = 1; step < shape.steps; step++) expect(byStep[step], `step ${step}`).toBeGreaterThanOrEqual(byStep[step - 1]);
    // and each step plays exactly what the simulator plays when it draws that raw value
    expect(byStep).toEqual(Array.from({ length: shape.steps }, (_, step) => damageAtRaw(seed, shape.raw(step))));
  });

  test('a generation has 16 steps from Gen 3 on and 39 in Gens 1 and 2', () => {
    expect(shape.steps).toBe(rules.generation <= 2 ? 39 : 16);
  });
});

describe.each(cases)('a PRNG with nothing forced plays the plain PRNG: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('the log and the final seed equal the plain turn over every scene and three seeds', () => {
    let played = 0;
    for (const scene of GRID_SCENES) {
      for (const seed of SEEDS.slice(0, 3)) {
        const plain = boardOf(rules, scene, mode, seed);
        if (!plain) break;
        playClicks(plain, clicksOf(scene, mode));
        const passed = forcedTurn(rules, scene, mode, seed, []);
        expect(stableLog(passed.battle), `${scene.id} ${seed}`).toBe(stableLog(plain));
        expect(passed.battle.prng.getSeed(), `${scene.id} ${seed}`).toEqual(plain.prng.getSeed());
        played++;
      }
    }
    expect(played).toBeGreaterThan(0);
  });
});
