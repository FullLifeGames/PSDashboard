import { describe, expect, test } from 'vitest';
import { PRNG, type Battle, type PRNGSeed } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { DrawNamer } from '../src/dice/namer';
import { RecordingPRNG } from '../src/dice/prng';
import { scriptRoll } from '../src/dice/answer';
import { genShape } from '../src/dice/recognize';
import { dieKey, type DieName, type Draw } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { boardOf, clicksOf, GRID_SCENES, playClicks, RULES, seedOf, type Mode } from './dice-fixtures';

/**
 * Round 86 (T299): the namer is the module's naming outside a forced turn. The tree's scripted PRNGs ask it for the name of a
 * draw before they answer, so it must name every draw the way the forced turn's recording PRNG does, in every generation and
 * the Champions mod, and the roll mapping must put a script's roll on the step of the generation's own damage roll.
 */
await loadSimMods('gen9championsou');

/** A stream that asks the namer once per call of the simulator (a chance, a sample, a shuffle or a bare draw). */
class NamingPRNG extends PRNG {
  readonly names: DieName[] = [];
  private namer: DrawNamer | null = null;
  private depth = 0;

  constructor(seed: PRNGSeed) {
    super(seed);
  }

  attach(battle: Battle): void {
    this.namer = new DrawNamer(battle);
  }

  release(): void {
    this.namer?.release();
  }

  private ask<T>(draw: Draw, run: () => T): T {
    if (this.depth > 0) return run();
    const name = this.namer?.name(draw) ?? null;
    if (name) this.names.push(name);
    this.depth++;
    try {
      return run();
    } finally {
      this.depth--;
    }
  }

  override randomChance(numerator: number, denominator: number): boolean {
    return this.ask({ call: 'chance', from: denominator, numerator }, () => super.randomChance(numerator, denominator));
  }

  override random(from?: number, to?: number): number {
    return this.ask({ call: 'random', from, to }, () => super.random(from, to));
  }

  override sample<T>(items: readonly T[]): T {
    return this.ask({ call: 'sample', from: items.length, items }, () => super.sample(items));
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    this.ask({ call: 'shuffle', from: start, to: end }, () => super.shuffle(items, start, end));
  }
}

const countsOf = (keys: Iterable<string>): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

const cases = RULES.flatMap(rules => (['singles', 'doubles'] as Mode[]).filter(mode => mode === 'singles' || rules.doubles).map(mode => ({ rules, mode })));

describe.each(cases)('the namer names the draws of a turn as the recording PRNG does: $rules.name $mode', ({ rules, mode }) => {
  test('every scene, two seeds: the same dice under the same keys', () => {
    let named = 0;
    for (const scene of GRID_SCENES) {
      for (const index of [0, 1]) {
        const seed = seedOf(index);
        const reference = boardOf(rules, scene, mode, seed);
        if (!reference) break;
        const recording = new RecordingPRNG(new PRNG(seed as PRNGSeed), watchBattle(reference));
        reference.prng = recording;
        playClicks(reference, clicksOf(scene, mode));
        const expected = countsOf([...recording.record].flatMap(([key, answers]) => answers.map(() => key)));

        const board = boardOf(rules, scene, mode, seed)!;
        const naming = new NamingPRNG(seed as PRNGSeed);
        naming.attach(board);
        board.prng = naming;
        playClicks(board, clicksOf(scene, mode));
        naming.release();
        expect(countsOf(naming.names.map(dieKey)), `${scene.id} ${seed}`).toEqual(expected);
        named += naming.names.length;
      }
    }
    expect(named, 'the scenes name dice').toBeGreaterThan(0);
  });

  test('a released namer names nothing and leaves the battle as it was', () => {
    const scene = GRID_SCENES[0];
    const board = boardOf(rules, scene, mode, seedOf(2))!;
    const keys = Object.getOwnPropertyNames(board).sort();
    const naming = new NamingPRNG(seedOf(2) as PRNGSeed);
    naming.attach(board);
    naming.release();
    naming.release();
    expect(Object.getOwnPropertyNames(board).sort()).toEqual(keys);
    board.prng = naming;
    playClicks(board, clicksOf(scene, mode));
    expect(naming.names).toEqual([]);
  });
});

describe.each(RULES)('a script\'s roll lands on the damage roll of the generation: $name', rules => {
  const shape = genShape(rules.generation).roll;
  const raws = Array.from({ length: 16 }, (_, roll) => scriptRoll(rules.generation, roll));

  test('the top roll (0) is the highest damage and the bottom roll (15) the lowest', () => {
    expect(raws[0]).toBe(shape.raw(shape.steps - 1));
    expect(raws[15]).toBe(shape.raw(0));
  });

  test('a lower script roll never hurts less, and every raw value is one the generation draws', () => {
    const drawn = new Set(Array.from({ length: shape.steps }, (_, step) => shape.raw(step)));
    for (const raw of raws) expect(drawn.has(raw)).toBe(true);
    const damage = (raw: number): number => (shape.scope === 'randomizer' ? 100 - raw : raw);
    for (let roll = 1; roll < 16; roll++) expect(damage(raws[roll]), `roll ${roll}`).toBeLessThanOrEqual(damage(raws[roll - 1]));
  });

  test(rules.generation >= 3 ? 'the draw of random(16) is the script\'s roll itself' : 'the 16 rolls spread over the 39 steps of random(217, 256)', () => {
    if (rules.generation >= 3) expect(raws).toEqual(Array.from({ length: 16 }, (_, roll) => roll));
    else expect(new Set(raws).size).toBe(16);
  });
});
