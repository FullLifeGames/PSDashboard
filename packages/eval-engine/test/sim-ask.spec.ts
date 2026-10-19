import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { PRNG } from '@pkmn/sim';
import type { Battle, Pokemon } from '@pkmn/sim';
import { twinBattle as coreTwinBattle } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { serializeBattleStable } from '../src/forward/serialize';
import type { SimFastLever } from '../src/forward/sim-fast/state';
import {
  AskLeak, FixedDice, askCheckOn, callHandler, copyOf, fingerprint, isolated, playOnCopy, setAskCheck, twinBattle, twinFormat,
} from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { loadPositions, withSimFast } from './sim-fast-helpers';
import { MODES, MODES_MOVES_SHORT, MOVES_PER_RULES_DOUBLES, MOVES_PER_RULES_SUITE, RULE_SETS, modeName, oneTurn, sweepRules } from './sim-ask-sweep';

/**
 * Round 72 (T239): the one module that asks the simulator. Its pieces are held against the simulator itself: the twin
 * battle is the one the six callers built by hand, a play on a copy leaves the live battle byte for byte as it was in
 * every speed-layer mode, a handler called with a throwaway `this` leaves the live battle and the Dex entry alone, and
 * a sweep calls every handler the stand-ins of the engine reach, in every generation and the Champions mod, on the
 * copy-on-write view and on a real copy: where the view answers, the copy answers the same.
 */

await loadSimMods('gen9championsou');

beforeAll(() => setAskCheck(true));
afterAll(() => setAskCheck(null));

describe('twin battle', () => {
  test('the module hands out replay-core\'s factory', () => {
    expect(twinBattle).toBe(coreTwinBattle);
  });

  test('a Champions format is built only where the mod is registered', async () => {
    vi.resetModules();
    const fresh = await import('../src/sim-ask');
    expect(fresh.twinFormat(9, true)).toBeNull();
    expect(fresh.twinFormat(9, false)).toBe('gen9customgame');
    expect(twinFormat(9, true)).toBe('gen9championsou');
    expect(twinFormat(4, false)).toBe('gen4customgame');
  });

  test.each([['gen9customgame', 50], ['gen9championsou', 50]])('%s: a twin of one body plays a turn', (format, level) => {
    const team = [set('Snorlax', ['tackle'], { level })];
    const made = twinBattle(format, { p1: { name: 'Body', team }, p2: { name: 'Foe', team } });
    expect(made.sides[0].active[0]?.species.name).toBe('Snorlax');
    made.choose('p1', 'move 1');
    made.choose('p2', 'move 1');
    expect(made.turn).toBe(2);
  });
});

describe('fingerprint', () => {
  test('it moves with the log, the dice, the bodies and the Dex entry it is told about', () => {
    const battle = battleOf('gen9customgame', [set('Snorlax', ['tackle'])], [set('Snorlax', ['tackle'])]);
    const before = fingerprint(battle, [battle.dex.moves.get('tackle')]);
    expect(fingerprint(battle, [battle.dex.moves.get('tackle')])).toBe(before);
    battle.add('|leak');
    expect(fingerprint(battle, [battle.dex.moves.get('tackle')])).not.toBe(before);
    const drawn = fingerprint(battle);
    battle.prng.random();
    expect(fingerprint(battle)).not.toBe(drawn);
    const moves = battle.dex.moves.get('tackle') as unknown as { basePower: number };
    const entryBefore = fingerprint(battle, [moves]);
    moves.basePower += 1;
    try {
      expect(fingerprint(battle, [moves])).not.toBe(entryBefore);
    } finally {
      moves.basePower -= 1;
    }
  });

  test('the check is off until it is switched on', () => {
    setAskCheck(null);
    try {
      expect(askCheckOn()).toBe(false);
      expect(playOnCopy(battleOf('gen9customgame', [set('Snorlax', ['tackle'])], [set('Snorlax', ['tackle'])]), new PRNG('1,2,3,4'), () => 7)).toBe(7);
    } finally {
      setAskCheck(true);
    }
  });
});

describe('playOnCopy', () => {
  const positions = loadPositions();

  test('there are fixtures of every game type', () => {
    expect(positions.some(position => position.gameType === 'singles')).toBe(true);
    expect(positions.some(position => position.gameType === 'doubles')).toBe(true);
  });

  /** The first fixture of each format the files hold (singles of Gens 3, 6, 8 and 9, doubles of Gen 9): the eight-mode matrix over all of them is the lane's probe. */
  const few = positions.filter((position, index) => positions.findIndex(other => other.format === position.format) === index);

  const leavesLive = (list: typeof positions) => {
    for (const position of list) {
      const live = positionBattle(createRootPosition(position.serialized));
      const before = fingerprint(live);
      const after = playOnCopy(live, new PRNG('1,2,3,4'), oneTurn(position.serialized));
      expect(fingerprint(live), position.id).toBe(before);
      expect(after, position.id).not.toBe(serializeBattleStable(live));
    }
  };

  test('there is a fixture of each game type among the ones the matrix picks', () => {
    expect(new Set(few.map(position => position.gameType))).toEqual(new Set(['singles', 'doubles']));
  });

  test('a turn on the copy leaves the live battle as it was, every fixture', () => {
    leavesLive(positions);
  });

  test.each(MODES.map(mode => [modeName(mode), mode] as const))('%s: a turn on the copy leaves the live battle as it was, one fixture of each kind', (_name, mode) => {
    withSimFast(mode, () => leavesLive(few));
  });

  test('the turn on the copy reads the same in all eight modes', () => {
    const digest = (mode: readonly SimFastLever[]) => withSimFast(mode, () => few.map(position => {
      const live = positionBattle(createRootPosition(position.serialized));
      return playOnCopy(live, new PRNG('1,2,3,4'), oneTurn(position.serialized));
    }));
    const base = digest([]);
    for (const mode of MODES.slice(1)) expect(digest(mode), modeName(mode)).toEqual(base);
  });

  test.each(MODES.map(mode => [modeName(mode), mode] as const))('%s: the copy shares no state with the live battle', (_name, mode) => {
    withSimFast(mode, () => {
      const live = battleOf('gen9customgame', [set('Snorlax', ['tackle']), set('Machamp', ['tackle'])], [set('Snorlax', ['tackle'])]);
      const before = fingerprint(live);
      playOnCopy(live, new PRNG('1,2,3,4'), copy => {
        const body = copy.sides[0].active[0] as Pokemon;
        body.boosts.atk = 6;
        body.hp = 1;
        body.volatiles['leaky'] = { id: 'leaky' } as never;
        copy.sides[0].sideConditions['spikes'] = { id: 'spikes' } as never;
        copy.field.weather = 'raindance' as never;
        copy.log.push('|copy');
        copy.prng.random();
      });
      expect(fingerprint(live)).toBe(before);
    });
  });

  test('negative control: a play that writes the live battle is caught', () => {
    const live = battleOf('gen9customgame', [set('Snorlax', ['tackle'])], [set('Snorlax', ['tackle'])]);
    expect(() => playOnCopy(live, new PRNG('1,2,3,4'), () => { live.log.push('|leak'); })).toThrow(AskLeak);
    expect(() => playOnCopy(live, new PRNG('1,2,3,4'), () => { (live.sides[0].active[0] as Pokemon).boosts.spe = 3; })).toThrow(AskLeak);
    expect(() => playOnCopy(live, new PRNG('1,2,3,4'), () => { live.prng.random(); })).toThrow(AskLeak);
  });

  test('FixedDice answer every draw with one quantile, or every chance with one answer', () => {
    const quantile = new FixedDice({ quantile: 0.5 });
    expect([quantile.random(), quantile.random(4), quantile.random(10, 20)]).toEqual([0.5, 2, 15]);
    const yes = new FixedDice({ chance: true });
    const no = new FixedDice({ chance: false });
    expect([yes.randomChance(1, 1000), no.randomChance(999, 1000)]).toEqual([true, false]);
    expect(copyOf).toBeTypeOf('function');
  });
});

describe('callHandler', () => {
  const MOVER = (ability = 'No Ability') => set('Snorlax', ['tackle'], { ability });

  test('a handler that draws and writes the log leaves the live battle alone and answers as it does on a copy', () => {
    const seen = new Set<unknown>();
    for (let seed = 1; seed <= 60; seed++) {
      const live = battleOf('gen9customgame', [MOVER()], [MOVER()]);
      live.prng = new PRNG([seed, 2, 3, 4]);
      const claw = live.dex.items.get('quickclaw') as unknown as { onFractionalPriority: unknown };
      const before = fingerprint(live, [claw]);
      const view = isolated(live);
      const answered = callHandler(claw.onFractionalPriority as never, view, [0, view.sides[0].active[0], view.sides[1].active[0], {}]);
      expect(fingerprint(live, [claw])).toBe(before);
      expect(answered.ok).toBe(true);
      const onCopy = playOnCopy(live, new PRNG([seed, 2, 3, 4]), copy => (
        (claw.onFractionalPriority as (this: Battle, ...a: unknown[]) => unknown).call(copy, 0, copy.sides[0].active[0], copy.sides[1].active[0], {})
      ));
      expect(answered.ok && answered.value).toBe(onCopy);
      seen.add(onCopy);
    }
    expect(seen.size).toBe(2);
  });

  test('a shield that punishes contact drops the stage on the view only', () => {
    const live = battleOf('gen9customgame', [MOVER()], [MOVER()]);
    const shield = live.dex.conditions.get('kingsshield') as unknown as { onTryHit: unknown };
    const before = fingerprint(live, [shield]);
    const view = isolated(live);
    const [target, source] = [view.sides[0].active[0] as Pokemon, view.sides[1].active[0] as Pokemon];
    const contact = live.dex.getActiveMove('tackle');
    const answered = callHandler(shield.onTryHit as never, view, [target, source, contact]);
    expect(answered.ok).toBe(true);
    expect(fingerprint(live, [shield])).toBe(before);
    expect(source.boosts.atk).toBe(-1);
    expect((live.sides[1].active[0] as Pokemon).boosts.atk).toBe(0);
  });

  test('a handler that needs more than the facade gets the typed answer, and the live battle stays as it was', () => {
    const live = battleOf('gen9customgame', [MOVER()], [MOVER()]);
    const claw = live.dex.items.get('quickclaw') as unknown as { onFractionalPriority: unknown };
    const before = fingerprint(live, [claw]);
    const answered = callHandler(claw.onFractionalPriority as never, {}, [0, live.sides[0].active[0], live.sides[1].active[0], {}]);
    expect(answered).toEqual({ ok: false });
    expect(fingerprint(live, [claw])).toBe(before);
  });

  test('negative control: a handler that reaches the live battle past its view is caught', () => {
    const live = battleOf('gen9customgame', [MOVER()], [MOVER()]);
    const view = isolated(live);
    expect(() => callHandler((() => { live.log.push('|leak'); }) as never, view, [])).toThrow(AskLeak);
  });

  test('a view refuses a Map and a Set instead of passing it through', () => {
    const live = { probeMap: new Map([['a', 1]]), probeSet: new Set(['a']), nested: { count: 1 } };
    const view = isolated(live);
    expect(callHandler(function (this: typeof live) { return this.probeMap.get('a'); } as never, view, [])).toEqual({ ok: false });
    expect(callHandler(function (this: typeof live) { this.probeSet.add('b'); return 1; } as never, view, [])).toEqual({ ok: false });
    expect(callHandler(function (this: typeof live) { this.nested.count += 1; return this.nested.count; } as never, view, [])).toEqual({ ok: true, value: 2 });
    expect([live.probeMap.size, live.probeSet.size, live.nested.count]).toEqual([1, 1, 1]);
  });

  test('a view writes to an array, an index and a nested object without reaching the live ones', () => {
    const live = battleOf('gen9customgame', [MOVER(), MOVER()], [MOVER()]);
    const before = fingerprint(live);
    const view = isolated(live);
    const [first, second] = view.sides[0].pokemon;
    second.hp = 3;
    view.sides[0].pokemon.reverse();
    expect(view.sides[0].pokemon[0]).toBe(second);
    expect(view.sides[0].pokemon[0].hp).toBe(3);
    expect(view.sides[0].pokemon[1]).toBe(first);
    delete (view.sides[0].active[0] as Pokemon).boosts.atk;
    view.sides[0].pokemon.length = 1;
    expect(view.sides[0].pokemon).toHaveLength(1);
    expect(live.sides[0].pokemon).toHaveLength(2);
    expect(live.sides[0].pokemon[1].hp).toBe(live.sides[0].pokemon[1].maxhp);
    expect(fingerprint(live)).toBe(before);
  });
});

describe('sweep: every handler the stand-ins reach', () => {
  test.each(RULE_SETS)('$name: onTryHit, onModifyMove, onFractionalPriority, onModifyPriority on the view and on a copy', rules => {
    const { moves, calls, refused } = sweepRules(rules, rules.doubles ? MOVES_PER_RULES_DOUBLES : MOVES_PER_RULES_SUITE);
    process.stdout.write(`sim-ask sweep ${rules.format}: ${moves} moves, ${calls} calls, ${refused.length} refused (${[...new Set(refused)].join(' ')})\n`);
  }, 300_000);

  // The sweep in every speed-layer mode, all fixtures and a longer list of moves is the lane's probe (sim-ask-matrix.vt.ts); the suite takes the layer off.
  test('gen 9 doubles with the speed layer off: the short sweep on the view and on a copy', () => {
    const rules = RULE_SETS.find(entry => entry.name === 'gen 9 doubles')!;
    withSimFast([], () => expect(sweepRules(rules, MODES_MOVES_SHORT).calls).toBeGreaterThan(0));
  });

  test('the twin format builds for every rule set', () => {
    for (const { gen } of RULE_SETS.filter(rules => !rules.doubles)) expect(twinFormat(gen, false)).toBe(`gen${gen}customgame`);
  });
});
