import { describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeBattleStable } from '../src/forward/serialize';
import { copyBattle } from '../src/forward/sim-fast';
import { attachDispatch } from '../src/forward/sim-fast/dispatch';
import { configureSimFast, SIM_FAST_DEFAULT } from '../src/forward/sim-fast/state';
import { copyOf } from '../src/sim-ask/copy';
import { watchBattle } from '../src/dice/watch';
import { boardOf, clicksOf, GRID_SCENES, playClicks, RULES, seedOf, stableLog, type Mode, type Rules } from './dice-fixtures';
import { fingerprint } from './power-oracle';

// Round 82 (forced dice), decision D1. The watch is a set of own-property wrappers on one battle for one forced turn. It
// leaves no trace: the same log and seed, the same stable serialization, the same own keys, the battle copyable after, and
// the speed layer's pre-check back in place.
await loadSimMods('gen9championsou');
configureSimFast(SIM_FAST_DEFAULT);

const SCENES = GRID_SCENES;

const SEEDS = [0, 1, 2, 3].map(seedOf);
const keysOf = (battle: Battle): string =>
  JSON.stringify([Object.getOwnPropertyNames(battle).sort(), Object.getOwnPropertyNames((battle as unknown as { actions: object }).actions).sort()]);

const cases = RULES.flatMap(rules => (['singles', 'doubles'] as Mode[]).filter(mode => mode === 'singles' || rules.doubles).map(mode => ({ rules, mode })));

describe.each(cases)('the watch leaves no trace: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('the log and the seed of a watched turn equal the plain turn, over every scene and four seeds', () => {
    let played = 0;
    for (const scene of SCENES) {
      for (const seed of SEEDS) {
        const plain = boardOf(rules, scene, mode, seed);
        if (!plain) break;
        const watched = boardOf(rules, scene, mode, seed)!;
        const watch = watchBattle(watched);
        playClicks(watched, clicksOf(scene, mode));
        watch.uninstall();
        playClicks(plain, clicksOf(scene, mode));
        expect(stableLog(watched), `${scene.id} ${seed}`).toBe(stableLog(plain));
        expect(watched.prng.getSeed(), `${scene.id} ${seed}`).toEqual(plain.prng.getSeed());
        played++;
      }
    }
    expect(played).toBeGreaterThan(0);
  });

  test('the stable serialization is equal before, during and after, and the own keys come back', () => {
    const scene = SCENES[0];
    const battle = boardOf(rules, scene, mode, seedOf(5))!;
    const before = serializeBattleStable(battle);
    const keys = keysOf(battle);
    const watch = watchBattle(battle);
    expect(serializeBattleStable(battle)).toBe(before);
    playClicks(battle, clicksOf(scene, mode));
    const during = serializeBattleStable(battle);
    watch.uninstall();
    expect(keysOf(battle)).toBe(keys);
    expect(serializeBattleStable(battle)).toBe(during);
  });

  test('the battle copies after the watch left, and the copy equals the copy of an unwatched twin', () => {
    const scene = SCENES[0];
    const battle = boardOf(rules, scene, mode, seedOf(6))!;
    const twin = boardOf(rules, scene, mode, seedOf(6))!;
    const watch = watchBattle(battle);
    playClicks(battle, clicksOf(scene, mode));
    watch.uninstall();
    playClicks(twin, clicksOf(scene, mode));
    const copies = [battle, twin].map(source => {
      const copy = copyOf(source);
      copy.prng = new PRNG(source.prng.getSeed());
      return serializeBattleStable(copy);
    });
    expect(copies[0]).toBe(copies[1]);
  });
});

describe('the speed layer and the watch', () => {
  test('the pre-check is the battle\'s runEvent again after the watch left', () => {
    const scene = SCENES[0];
    const rules = RULES[8];
    const battle = boardOf(rules, scene, 'singles', seedOf(1))!;
    attachDispatch(battle);
    const attached = (battle as unknown as { runEvent: unknown }).runEvent;
    expect(Object.hasOwn(battle, 'runEvent')).toBe(true);
    const watch = watchBattle(battle);
    expect((battle as unknown as { runEvent: unknown }).runEvent).not.toBe(attached);
    playClicks(battle, clicksOf(scene, 'singles'));
    watch.uninstall();
    expect((battle as unknown as { runEvent: unknown }).runEvent).toBe(attached);
  });

  test('a watched turn after the pre-check plays the plain turn', () => {
    const scene = SCENES[7];
    const rules = RULES[8];
    const plain = boardOf(rules, scene, 'singles', seedOf(2))!;
    const watched = boardOf(rules, scene, 'singles', seedOf(2))!;
    attachDispatch(watched);
    const watch = watchBattle(watched);
    playClicks(watched, clicksOf(scene, 'singles'));
    watch.uninstall();
    playClicks(plain, clicksOf(scene, 'singles'));
    expect(stableLog(watched)).toBe(stableLog(plain));
    expect(watched.prng.getSeed()).toEqual(plain.prng.getSeed());
  });
});

describe('the watch reads the battle and writes nothing', () => {
  test('the fingerprint of the position is equal before and after', () => {
    for (const rules of [RULES[1], RULES[8], RULES[9]]) {
      const battle = boardOf(rules, SCENES[0], 'singles', seedOf(3))!;
      const bodies = battle.sides.flatMap(side => side.pokemon);
      const before = fingerprint(battle, bodies, 'tackle');
      const watch = watchBattle(battle);
      expect(fingerprint(battle, bodies, 'tackle')).toBe(before);
      watch.uninstall();
      expect(fingerprint(battle, bodies, 'tackle')).toBe(before);
    }
  });

  test('uninstalling twice is harmless', () => {
    const battle = boardOf(RULES[8], SCENES[0], 'singles', seedOf(4))!;
    const keys = keysOf(battle);
    const watch = watchBattle(battle);
    watch.uninstall();
    watch.uninstall();
    expect(keysOf(battle)).toBe(keys);
  });
});

// Round 86 (T299): the tree's scripted PRNGs keep a watch on a forked battle while that battle is copied (a forced switch's
// snapshot, a child's template). The wrappers are hidden from key walks, so such a copy carries no wrapper of the old watch.
describe.each(cases)('the wrappers are hidden from key walks: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  const enumerable = (battle: Battle): string[] => [
    ...Object.keys(battle), ...Object.keys((battle as unknown as { actions: object }).actions),
    ...battle.sides.flatMap(side => side.pokemon.flatMap(body => Object.keys(body))),
  ].sort();

  test('a watched battle shows the own keys of an unwatched twin, and its copy carries no wrapper', () => {
    const scene = SCENES[0];
    const battle = boardOf(rules, scene, mode, seedOf(7))!;
    const twin = boardOf(rules, scene, mode, seedOf(7))!;
    const watch = watchBattle(battle);
    expect(enumerable(battle)).toEqual(enumerable(twin));
    const copy = copyBattle(battle);
    const plainCopy = copyBattle(twin);
    expect(copy, 'the speed layer copies a watched battle').not.toBeNull();
    expect(enumerable(copy!)).toEqual(enumerable(plainCopy!));
    expect(Object.hasOwn(copy!, 'runEvent') && copy!.runEvent === battle.runEvent).toBe(false);
    // a wrapper an own property carried into the copy hears nothing: the old watch sees none of the copy's turn
    copy!.prng = new PRNG(battle.prng.getSeed());
    playClicks(copy!, clicksOf(scene, mode));
    expect(watch.moves.size, 'moves the old watch saw on the copy').toBe(0);
    expect(watch.scope()).toBeNull();
    watch.uninstall();
    expect(enumerable(battle)).toEqual(enumerable(twin));
  });

  test('a hidden wrapper still plays: the watched turn equals the plain turn', () => {
    const scene = SCENES[0];
    const plain = boardOf(rules, scene, mode, seedOf(8))!;
    const watched = boardOf(rules, scene, mode, seedOf(8))!;
    const watch = watchBattle(watched);
    playClicks(watched, clicksOf(scene, mode));
    expect(watch.scope()).toBeNull();
    watch.uninstall();
    playClicks(plain, clicksOf(scene, mode));
    expect(stableLog(watched)).toBe(stableLog(plain));
  });
});
