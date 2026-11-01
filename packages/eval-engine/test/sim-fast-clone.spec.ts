import { PRNG, State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { afterEach, describe, expect, test } from 'vitest';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import { restoreSideInvariants, serializeBattleStable } from '../src/forward/serialize';
import { cloneBattle } from '../src/forward/sim-fast/clone';
import { copyBattle } from '../src/forward/sim-fast/index';
import { configureSimFast, resetSimFastForTests, simFastStatus } from '../src/forward/sim-fast/state';
import { loadPositions, SEEDS } from './sim-fast-helpers';

const positions = loadPositions();
const full = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));
const fresh = (serialized: string) => deserializeFromParsed(parseSearchState(serialized));

afterEach(() => resetSimFastForTests());

describe('cloneBattle', () => {
  test('with its history a copy serializes exactly as its source, every fixture', () => {
    for (const position of positions) {
      const source = fresh(position.serialized);
      source.prng = new PRNG(SEEDS[0]);
      expect(full(cloneBattle(source, { history: true })), position.id).toBe(full(source));
    }
  });

  test('a fork copy equals a fresh deserialization, every fixture, both seeds', () => {
    for (const position of positions) {
      const parsed = parseSearchState(position.serialized);
      const template = deserializeFromParsed(parsed);
      for (const seed of SEEDS) {
        const copy = cloneBattle(template);
        restoreSideInvariants(copy);
        copy.prng = new PRNG(seed);
        const fork = deserializeFromParsed(parsed);
        fork.prng = new PRNG(seed);
        expect(serializeBattleStable(copy), `${position.id} ${seed}`).toBe(serializeBattleStable(fork));
      }
    }
  });

  test('a copy never takes the source PRNG and starts with an empty history', () => {
    const source = fresh(positions[0].serialized);
    source.log.push('|probe|');
    const copy = cloneBattle(source);
    expect(copy.prng).toBeNull();
    expect(copy.log).toEqual([]);
    expect(copy.sentLogPos).toBe(0);
    expect(cloneBattle(source, { history: true }).prng).not.toBe(source.prng);
  });

  test('the rebuilt closures belong to the copy', () => {
    const source = fresh(positions[0].serialized);
    const copy = cloneBattle(source);
    const mon = copy.sides[0].pokemon[0];
    expect(mon.getHealth).not.toBe(source.sides[0].pokemon[0].getHealth);
    mon.hp = 0;
    expect(mon.getHealth().secret).toBe('0 fnt');
    expect(source.sides[0].pokemon[0].getHealth().secret).not.toBe('0 fnt');
  });

  test('a class outside the positive list throws; through copyBattle it falls back', () => {
    class Foreign { value = 1; }
    const source = fresh(positions[0].serialized);
    (source.sides[0].pokemon[0] as unknown as Record<string, unknown>).foreign = new Foreign();
    expect(() => cloneBattle(source)).toThrow(/no rule for class Foreign/);
    configureSimFast(['clone']);
    expect(copyBattle(source)).toBeNull();
    expect(simFastStatus()).toBe('fallback');
  });

  // Round 82, the user's test of 01.11.2026 (gen9draft-2058494320, turn 1): a copy of a branch's live battle kept the battle's
  // `send`, so the copy's output went into the live stream; a click the copy refused read as a refused turn of the branch.
  type Fields = Record<string, unknown>;
  const fields = (object: object): Fields => object as Fields;
  const levels = (battle: Battle): [string, Fields][] => [
    ['battle', fields(battle)], ['field', fields(battle.field)],
    ...battle.sides.flatMap((side, i): [string, Fields][] => [
      [`side ${i}`, fields(side)], ...side.pokemon.map((pokemon, j): [string, Fields] => [`side ${i} pokemon ${j}`, fields(pokemon)]),
    ]),
  ];

  test('a copy shares a function with its source only where a deserialized copy does, every fixture', () => {
    for (const position of positions) {
      const source = fresh(position.serialized);
      // a branch battle's send writes its stream
      (source as unknown as { send: () => void }).send = () => {};
      const copy = levels(cloneBattle(source));
      const standard = levels(fresh(serializeBattleStable(source)));
      levels(source).forEach(([label, object], index) => {
        for (const key of Object.keys(object)) {
          if (typeof object[key] !== 'function' || copy[index][1][key] !== object[key]) continue;
          expect(standard[index][1][key], `${position.id}: ${label}.${key}`).toBe(object[key]);
        }
      });
    }
  });

  test('a click the copy refuses reaches no stream of its source', () => {
    const source = fresh(positions[0].serialized);
    const sent: string[] = [];
    (source as unknown as { send: (type: string) => void }).send = type => { sent.push(type); };
    const copy = cloneBattle(source);
    try {
      expect(copy.choose('p1', 'switch 99')).toBe(false);
    } catch {
      // with strict choices the simulator throws after it sent the error
    }
    expect(sent).toEqual([]);
  });
});
