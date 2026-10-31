import { describe, expect, test } from 'vitest';
import { PRNG } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { recognize } from '../src/dice/recognize';
import { dieKey, type DieName, type Draw } from '../src/dice/types';
import { watchBattle, type BattleWatch } from '../src/dice/watch';
import {
  boardOf, clicksOf, PIKACHU, playClicks, RULES, RULES_WITH_DOUBLES, seedOf, SNORLAX, type Mode, type Rules, type Scene,
} from './dice-fixtures';

// Round 82 (forced dice), decision D3. `recognize` maps one draw to the name of a die with two rules: the hook that ran right
// before the draw (accuracy, the crit from Gen 2 on), and the script call that holds the draw (the damage roll, the Gen 1
// crit). The spy below asks `recognize` for every draw the way the PRNG of the module does, so the lists are what the
// module would see. Draws no kind of this step names (secondaries, the speed tie, target picks) come out as null and are
// left out of the lists; later steps name them.
await loadSimMods('gen9championsou');

interface Named { name: DieName; /** Whether a hook was armed for this draw. */ armed: boolean }

class NamingPRNG extends PRNG {
  readonly named: Named[] = [];
  watch!: BattleWatch;
  private shape: Draw | null = null;

  private within<T>(draw: Draw, run: () => T): T {
    if (this.shape) return run();
    this.shape = draw;
    try {
      return run();
    } finally {
      this.shape = null;
    }
  }

  override random(from?: number, to?: number): number {
    const value = super.random(from, to);
    const draw = this.shape ?? { call: 'random', from, to };
    const armed = this.watch.armed !== null;
    const name = recognize(draw, this.watch, this.watch.battle.gen);
    this.watch.settle();
    if (name) this.named.push({ name, armed });
    return value;
  }

  override randomChance(numerator: number, denominator: number): boolean {
    return this.within({ call: 'chance', from: denominator, numerator }, () => super.randomChance(numerator, denominator));
  }

  override sample<T>(items: readonly T[]): T {
    return this.within({ call: 'sample', from: items.length }, () => super.sample(items));
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    this.within({ call: 'shuffle', from: start, to: end }, () => super.shuffle(items, start, end));
  }
}

/** Plays the scene's turn under the spy and returns what it named and the log. */
function named(rules: Rules, scene: Scene, mode: Mode, seed: string): { names: Named[]; log: string[] } | null {
  const battle = boardOf(rules, scene, mode, seed);
  if (!battle) return null;
  const spy = new NamingPRNG(seed);
  spy.watch = watchBattle(battle);
  battle.prng = spy;
  try {
    playClicks(battle, clicksOf(scene, mode));
  } finally {
    spy.watch.uninstall();
  }
  return { names: spy.named, log: battle.log };
}

const name = (slot: string, moveId: string, targetSlot: string, kind: DieName['kind']): DieName => ({ slot, moveId, targetSlot, kind });
const SEEDS = Array.from({ length: 16 }, (_, index) => seedOf(index));

const MEGA_KICK: Scene = { id: 'mega kick', a: SNORLAX(['megakick']), t: PIKACHU(['splash']) };

describe.each(RULES)('accuracy, crit and damage roll of one target: $name singles', (rules: Rules) => {
  test('a 75 percent move names its accuracy, and on a hit its crit and its damage roll, in this order', () => {
    let hits = 0;
    let misses = 0;
    for (const seed of SEEDS) {
      const played = named(rules, MEGA_KICK, 'singles', seed)!;
      const miss = played.log.some(line => line.startsWith('|-miss|'));
      const expected = miss
        ? [name('p1a', 'megakick', 'p2a', 'accuracy')]
        : ['accuracy', 'crit', 'damage-roll'].map(kind => name('p1a', 'megakick', 'p2a', kind as DieName['kind']));
      expect(played.names.map(entry => dieKey(entry.name)), `seed ${seed}`).toEqual(expected.map(dieKey));
      if (miss) misses++;
      else hits++;
    }
    expect(hits, 'some seed hits').toBeGreaterThan(0);
    expect(misses, 'some seed misses').toBeGreaterThan(0);
  });

  test('the hook rule names the accuracy, and the crit from Gen 2 on; the script rule names the Gen 1 crit and every damage roll', () => {
    const played = SEEDS.map(seed => named(rules, MEGA_KICK, 'singles', seed)!).filter(entry => !entry.log.some(line => line.startsWith('|-miss|')));
    expect(played.length).toBeGreaterThan(0);
    for (const { names } of played) {
      const byKind = Object.fromEntries(names.map(entry => [entry.name.kind, entry.armed]));
      expect(byKind.accuracy, 'accuracy by hook').toBe(true);
      expect(byKind.crit, rules.generation === 1 ? 'Gen 1 crit by script' : 'crit by hook').toBe(rules.generation !== 1);
      expect(byKind['damage-roll'], 'damage roll by script').toBe(false);
    }
  });
});

describe.each(RULES)('a Substitute in front changes no name: $name singles', (rules: Rules) => {
  test('the kicks and the Air Slash name the same dice behind a Substitute as in front of the body', () => {
    for (const move of ['megakick', 'airslash']) {
      const scene: Scene = {
        id: `${move} into a Substitute`, a: SNORLAX([move]), t: PIKACHU(['splash']),
        setup: battle => void battle.sides[1].active[0]!.addVolatile('substitute'),
      };
      for (const seed of SEEDS.slice(0, 8)) {
        const played = named(rules, scene, 'singles', seed);
        if (!played) break;
        const miss = played.log.some(line => line.startsWith('|-miss|'));
        // Air Slash draws its flinch (Round 82, A3a) behind a Substitute too: the hit went into the Substitute, the entry is still drawn
        const expected = miss ? ['accuracy'] : ['accuracy', 'crit', 'damage-roll', ...(move === 'airslash' ? ['secondary'] : [])];
        expect(played.names.map(entry => entry.name.kind), `${move} ${seed}`).toEqual(expected);
        expect(played.names.every(entry => entry.name.targetSlot === 'p2a' && entry.name.moveId === move && entry.name.slot === 'p1a')).toBe(true);
      }
    }
  });
});

describe.each(RULES_WITH_DOUBLES)('Rock Slide in doubles: $name', (rules: Rules) => {
  const ROCK_SLIDE: Scene = { id: 'rock slide', a: SNORLAX(['rockslide']), t: PIKACHU(['splash']), spread: true };

  test('the accuracy of each target comes first in the order of the targets, then crit, damage roll and flinch of each target that was hit', () => {
    let both = 0;
    let oneMissed = 0;
    for (const seed of SEEDS) {
      const played = named(rules, ROCK_SLIDE, 'doubles', seed)!;
      const missedTargets = played.log.filter(line => line.startsWith('|-miss|')).map(line => line.split('|')[3].slice(0, 3));
      const targets = ['p2a', 'p2b'];
      const hit = targets.filter(slot => !missedTargets.includes(slot));
      const expected: DieName[] = [];
      // Gen 3 plays a spread move target by target (tryMoveHit); Gens 4 and up draw every accuracy first (hitStepAccuracy).
      if (rules.generation !== 3) expected.push(...targets.map(target => name('p1a', 'rockslide', target, 'accuracy')));
      const flinch = (target: string): DieName => ({ ...name('p1a', 'rockslide', target, 'secondary'), effectId: 'flinch' });
      for (const target of targets) {
        if (rules.generation === 3) expected.push(name('p1a', 'rockslide', target, 'accuracy'));
        if (hit.includes(target)) expected.push(name('p1a', 'rockslide', target, 'crit'), name('p1a', 'rockslide', target, 'damage-roll'));
        // Gen 3 draws the flinch of a target right after its roll, Gens 4 and up after the rolls of every target
        if (rules.generation === 3 && hit.includes(target)) expected.push(flinch(target));
      }
      if (rules.generation !== 3) expected.push(...hit.map(flinch));
      expect(played.names.map(entry => dieKey(entry.name)), `seed ${seed}`).toEqual(expected.map(dieKey));
      if (missedTargets.length === 0) both++;
      else oneMissed++;
    }
    expect(both).toBeGreaterThan(0);
    expect(oneMissed).toBeGreaterThan(0);
  });
});

describe.each(RULES)('the confusion self-hit rolls a die of its own: $name', (rules: Rules) => {
  const CONFUSED: Scene = {
    id: 'confused', a: SNORLAX(['megakick']), t: PIKACHU(['splash']),
    setup: battle => void battle.sides[0].active[0]!.addVolatile('confusion'),
  };

  // Gens 1 and 2 compute the self-hit without a damage roll (Gen 1 inline, Gen 2 with noDamageVariance): only the check draws.
  test('the roll of the hurt body carries the condition and no move die follows it', () => {
    let selfHits = 0;
    for (let index = 0; index < 40; index++) {
      const played = named(rules, CONFUSED, 'singles', seedOf(index))!;
      if (!played.log.some(line => /\|-damage\|p1a: .*\|\[from\] confusion/.test(line))) continue;
      selfHits++;
      const rolls = played.names.filter(entry => entry.name.kind === 'damage-roll');
      expect(rolls.map(entry => entry.name.effectId), `seed ${index}`).toEqual(rules.generation <= 2 ? [] : ['confusion']);
      expect(played.names.filter(entry => entry.name.kind !== 'damage-roll'), `seed ${index}`).toEqual([]);
    }
    expect(selfHits, 'a seed hurts the body').toBeGreaterThan(0);
  });
});
