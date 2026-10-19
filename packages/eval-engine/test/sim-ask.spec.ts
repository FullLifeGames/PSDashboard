import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { PRNG } from '@pkmn/sim';
import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
import { twinBattle as coreTwinBattle } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { serializeBattleStable } from '../src/forward/serialize';
import type { SimFastLever } from '../src/forward/sim-fast/state';
import {
  AskLeak, FixedDice, askCheckOn, callHandler, copyOf, fingerprint, isolated, playOnCopy, setAskCheck, twinBattle, twinFormat,
} from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { loadPositions, withSimFast } from './sim-fast-helpers';

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

const LEVERS: readonly SimFastLever[] = ['rules', 'clone', 'dispatch'];
/** The eight subsets of the speed layer's levers (T103). */
const MODES: SimFastLever[][] = Array.from({ length: 8 }, (_, bits) => LEVERS.filter((_lever, index) => (bits >> index) & 1));
const modeName = (mode: readonly SimFastLever[]): string => (mode.length ? mode.join('+') : 'off');

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

  /** One whole turn on the copy: each side's first legal choice. */
  function oneTurn(serialized: string): (copy: Battle) => string {
    const root = createRootPosition(serialized);
    const choices = (['p1', 'p2'] as const).map(side => legalChoices(root, side)[0]?.choice);
    return copy => {
      for (const [index, side] of (['p1', 'p2'] as const).entries()) {
        const choice = choices[index];
        if (choice && choice !== 'wait') copy.choose(side, choice);
      }
      return serializeBattleStable(copy);
    };
  }

  test('there are fixtures of every game type', () => {
    expect(positions.some(position => position.gameType === 'singles')).toBe(true);
    expect(positions.some(position => position.gameType === 'doubles')).toBe(true);
  });

  test.each(MODES.map(mode => [modeName(mode), mode] as const))('%s: a turn on the copy leaves the live battle as it was, every fixture', (_name, mode) => {
    withSimFast(mode, () => {
      for (const position of positions) {
        const live = positionBattle(createRootPosition(position.serialized));
        const before = fingerprint(live);
        const after = playOnCopy(live, new PRNG('1,2,3,4'), oneTurn(position.serialized));
        expect(fingerprint(live), position.id).toBe(before);
        expect(after, position.id).not.toBe(serializeBattleStable(live));
      }
    });
  }, 240_000);

  test('the turn on the copy reads the same in all eight modes', () => {
    const digest = (mode: readonly SimFastLever[]) => withSimFast(mode, () => positions.map(position => {
      const live = positionBattle(createRootPosition(position.serialized));
      return playOnCopy(live, new PRNG('1,2,3,4'), oneTurn(position.serialized));
    }));
    const base = digest([]);
    for (const mode of MODES.slice(1)) expect(digest(mode), modeName(mode)).toEqual(base);
  }, 240_000);

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

/** Every gen the corpus plays, and the Champions mod. */
const RULE_SETS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen} singles`, format: `gen${gen}customgame`, gen, doubles: false })),
  { name: 'Champions singles', format: 'gen9championsou', gen: 9, doubles: false },
  ...[3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen} doubles`, format: `gen${gen}doublescustomgame`, gen, doubles: true })),
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', gen: 9, doubles: true },
];

const MOVES_PER_RULES = 16;
/** The sweep that runs in every speed-layer mode takes the first six kinds of move. */
const MODES_MOVES = 6;

interface Entry { id: string; exists?: boolean; gen?: number; isNonstandard?: string | null; [key: string]: unknown }

describe('sweep: every handler the stand-ins reach', () => {
  const bodies = (format: string, doubles: boolean): Battle => {
    const team = (species: string) => Array.from({ length: doubles ? 2 : 1 }, () => set(species, ['tackle', 'splash']));
    return battleOf(format, team('Snorlax'), team('Pikachu'));
  };
  /** [user side, user slot, target side, target slot]: a foe in singles, a foe and the ally in doubles. */
  const PAIRS = (doubles: boolean): [number, number, number, number][] => (doubles ? [[0, 0, 1, 0], [0, 0, 0, 1]] : [[0, 0, 1, 0]]);
  const stable = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'function' ? 'fn' : inner));
  const summary = (body: Pokemon, move: ActiveMove | null): string => stable([body.boosts, body.hp, body.status, Object.keys(body.volatiles).sort(), body.item, body.ability, move && { ...move }]);

  function entriesOf(battle: Battle, key: string): { kind: string; entry: Entry }[] {
    const { dex } = battle;
    const gen = dex.gen;
    const live = (entry: Entry) => entry.exists !== false && (entry.gen ?? 0) <= gen;
    const kinds: [string, Entry[]][] = [
      ['ability', dex.abilities.all() as unknown as Entry[]],
      ['item', dex.items.all() as unknown as Entry[]],
      ['move', dex.moves.all() as unknown as Entry[]],
      ['condition', Object.keys((dex.data as unknown as { Conditions: object }).Conditions).map(id => dex.conditions.get(id) as unknown as Entry)],
    ];
    return kinds.flatMap(([kind, entries]) => entries.filter(entry => live(entry) && typeof entry[key] === 'function').map(entry => ({ kind, entry })));
  }

  /** Calls every handler of the Dex on a view and on a copy of a fresh board; returns the counts, fails on the first difference. */
  function sweepRules({ format, doubles }: (typeof RULE_SETS)[number], movesCap: number): { moves: number; calls: number; refused: string[] } {
    const live = bodies(format, doubles);
    const standard = (live.dex.moves.all() as unknown as (Entry & { flags: Record<string, unknown>; category: string; target: string })[])
      .filter(move => (move.gen ?? 0) <= live.dex.gen && move.exists !== false && !move.isNonstandard);
    // The first move of every category, target and flag the generation has (the first sixteen): each handler meets the kinds of move.
    const kinds = new Map<string, string>();
    for (const move of standard) {
      for (const key of [`category:${move.category}`, `target:${move.target}`, ...Object.keys(move.flags).map(flag => `flag:${flag}`)]) {
        if (!kinds.has(key)) kinds.set(key, move.id);
      }
    }
    const moveIds = [...new Set(kinds.values())].slice(0, movesCap);
    let calls = 0;
    const refused: string[] = [];
    for (const key of ['onTryHit', 'onModifyMove', 'onFractionalPriority', 'onModifyPriority']) {
      for (const { kind, entry } of entriesOf(live, key)) {
        for (const [moveId, [userSide, userSlot, targetSide, targetSlot]] of moveIds.flatMap(id => PAIRS(doubles).map(pair => [id, pair] as const))) {
          const fingerprintExtras = [entry, live.dex.moves.get(moveId)];
          const before = fingerprint(live, fingerprintExtras);
          const view = isolated(live);
          const [mine, theirs] = [view.sides[userSide].active[userSlot] as Pokemon, view.sides[targetSide].active[targetSlot] as Pokemon];
          const viewMove = live.dex.getActiveMove(moveId);
          const handler = entry[key] as (this: Battle, ...args: unknown[]) => unknown;
          const args = (user: Pokemon, target: Pokemon, move: ActiveMove): unknown[] => (
            key === 'onModifyMove' ? [move, user, target]
              : key === 'onTryHit' ? [target, user, move]
                : [0, user, target, move]
          );
          const answered = callHandler(handler as never, view, args(mine, theirs, viewMove));
          expect(fingerprint(live, fingerprintExtras), `${kind} ${entry.id} ${key} ${moveId}`).toBe(before);
          calls++;
          if (!answered.ok) { refused.push(`${entry.id}/${key}`); continue; }
          const copyMove = live.dex.getActiveMove(moveId);
          const onCopy = playOnCopy(live, live.prng.clone(), copy => {
            const [a, b] = [copy.sides[userSide].active[userSlot] as Pokemon, copy.sides[targetSide].active[targetSlot] as Pokemon];
            try {
              const value = handler.call(copy, ...args(a, b, copyMove));
              return { threw: false, value: stable(value), mine: summary(a, copyMove), theirs: summary(b, null) };
            } catch {
              return { threw: true, value: '', mine: '', theirs: '' };
            }
          });
          expect(onCopy.threw, `${kind} ${entry.id} ${key} ${moveId}: the view answered where the copy threw`).toBe(false);
          expect(stable(answered.value), `${kind} ${entry.id} ${key} ${moveId}: value`).toBe(onCopy.value);
          expect(summary(mine, viewMove), `${kind} ${entry.id} ${key} ${moveId}: user`).toBe(onCopy.mine);
          expect(summary(theirs, null), `${kind} ${entry.id} ${key} ${moveId}: target`).toBe(onCopy.theirs);
        }
      }
    }
    expect(calls).toBeGreaterThan(0);
    return { moves: moveIds.length, calls, refused };
  }

  test.each(RULE_SETS)('$name: onTryHit, onModifyMove, onFractionalPriority, onModifyPriority on the view and on a copy', rules => {
    const { moves, calls, refused } = sweepRules(rules, MOVES_PER_RULES);
    process.stdout.write(`sim-ask sweep ${rules.format}: ${moves} moves, ${calls} calls, ${refused.length} refused (${[...new Set(refused)].join(' ')})\n`);
  }, 300_000);

  const MODE_RULES = ['gen 9 singles', 'gen 9 doubles', 'Champions doubles']
    .map(name => RULE_SETS.find(rules => rules.name === name))
    .filter((rules): rules is (typeof RULE_SETS)[number] => !!rules);
  test.each(MODES.map(mode => [modeName(mode), mode] as const))('%s: gen 9 singles, gen 9 doubles and Champions doubles on the view and on a copy, in this speed-layer mode', (_name, mode) => {
    withSimFast(mode, () => {
      for (const rules of MODE_RULES) expect(sweepRules(rules, MODES_MOVES).calls, rules.name).toBeGreaterThan(0);
    });
  }, 300_000);

  test('the twin format builds for every rule set', () => {
    for (const { gen } of RULE_SETS.filter(rules => !rules.doubles)) expect(twinFormat(gen, false)).toBe(`gen${gen}customgame`);
  });
});
