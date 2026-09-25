import * as esm from '@pkmn/sim';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { advancePositionWithLog, createRootPosition, legalChoices } from '../src/forward-model';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import { resetClosuresForTests, sharedClasses } from '../src/forward/sim-fast/clone';
import { compileClosures } from '../src/forward/sim-fast/clone-plan';
import { hashSources, PINNED_SIM_HASHES, setPinnedHashes } from '../src/forward/sim-fast/guard';
import { copyBattle } from '../src/forward/sim-fast/index';
import { configureSimFast, resetSimFastForTests, simFastStatus, takeSimFastReport } from '../src/forward/sim-fast/state';
import { loadPositions, SEEDS, stableLog, withSimFast } from './sim-fast-helpers';

const require = createRequire(import.meta.url);
const cjs = require('@pkmn/sim') as typeof esm;
const SIM_BUILD = join(dirname(require.resolve('@pkmn/sim')), '..', '..');
const positions = loadPositions();

afterEach(() => {
  setPinnedHashes(null);
  resetClosuresForTests();
  resetSimFastForTests();
});

const protosOf = (sim: typeof esm) => ({
  battle: sim.Battle.prototype, pokemon: sim.Pokemon.prototype,
  field: Object.getPrototypeOf(new sim.Battle({ formatid: sim.toID('gen9customgame') }).field) as object,
  formats: Object.getPrototypeOf(sim.Dex.formats) as object,
});

function twoBattles(formatid: string): [esm.Battle, esm.Battle] {
  const team = esm.Teams.pack([
    { name: 'A', species: 'Pikachu', item: '', ability: 'Static', moves: ['thunderbolt'], nature: 'Hardy', evs: {}, ivs: {}, level: 50, gender: '' },
    { name: 'B', species: 'Eevee', item: '', ability: 'Run Away', moves: ['tackle'], nature: 'Hardy', evs: {}, ivs: {}, level: 50, gender: '' },
  ] as unknown as esm.PokemonSet[]);
  const make = () => new esm.Battle({ formatid: esm.toID(formatid), seed: '1,2,3,4', p1: { name: 'x', team }, p2: { name: 'y', team } });
  return [make(), make()];
}

/** Own function-valued keys whose function differs between two battles: per-instance closures. */
function closures(a: object, b: object): string[] {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(left).filter(key => typeof left[key] === 'function' && left[key] !== right[key]).sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.mjs') ? [path] : [];
  });
}

describe('the pins the layer relies on', () => {
  test('the pinned hashes match both builds of the installed @pkmn/sim', () => {
    expect(hashSources(protosOf(esm))).toEqual(PINNED_SIM_HASHES.esm);
    expect(hashSources(protosOf(cjs))).toEqual(PINNED_SIM_HASHES.cjs);
  });

  test('the positive list holds the dex classes, read off a live battle', () => {
    for (const formatid of ['gen9customgame', 'gen3customgame']) {
      const [battle] = twoBattles(formatid);
      const names = [...sharedClasses(battle)].map(proto => (proto as { constructor: { name: string } }).constructor.name).sort();
      expect(names, formatid).toEqual(['Ability', 'Condition', 'DataMove', 'Format', 'Item', 'ModdedDex', 'RuleTable', 'Species']);
    }
  });

  test('per-instance closures are exactly Battle.send and the two Pokemon closures, in every gen', () => {
    for (const formatid of ['gen9customgame', 'gen9doublescustomgame', 'gen1customgame', 'gen2customgame', 'gen3customgame',
      'gen4customgame', 'gen8customgame']) {
      const [a, b] = twoBattles(formatid);
      expect(a.format.exists, formatid).toBe(true); // an unknown id would silently fall back to a gen9 format
      expect(closures(a, b), `${formatid} battle`).toEqual(['send']);
      expect(String(a.send), formatid).toMatch(/^\(\)\s*=>\s*\{\s*\}$/);
      expect(closures(a.field, b.field), `${formatid} field`).toEqual([]);
      expect(closures(a.sides[0], b.sides[0]), `${formatid} side`).toEqual([]);
      expect(closures(a.queue, b.queue), `${formatid} queue`).toEqual([]);
      expect(closures(a.actions, b.actions), `${formatid} actions`).toEqual([]);
      expect(closures(a.sides[0].pokemon[0], b.sides[0].pokemon[0]), `${formatid} pokemon`).toEqual(['getFullDetails', 'getHealth']);
    }
  });

  test('no mod replaces a method the pre-check or the rule table relies on', () => {
    const watched = ['runEvent', 'findEventHandlers', 'findPokemonEventHandlers', 'findSideEventHandlers', 'findFieldEventHandlers',
      'findBattleEventHandlers', 'getCallback', 'modify', 'getStatus', 'getAbility', 'getItem', 'getWeather', 'getTerrain', 'getRuleTable'];
    const dexes = (esm.Dex as unknown as { dexes: Record<string, { includeData(): { data: { Scripts: Record<string, unknown> } } }> }).dexes;
    const found: string[] = [];
    for (const [mod, dex] of Object.entries(dexes)) {
      const scripts = dex.includeData().data.Scripts;
      const groups: [string, Record<string, unknown>][] = [['', scripts]];
      for (const group of ['pokemon', 'field', 'side', 'actions', 'queue']) {
        if (scripts[group]) groups.push([`${group}.`, scripts[group] as Record<string, unknown>]);
      }
      for (const [prefix, entries] of groups) {
        for (const key of Object.keys(entries)) if (watched.includes(key)) found.push(`${mod}: ${prefix}${key}`);
      }
    }
    expect(found).toEqual([]);
  });

  test('runtime handler writes stay where 0.10.11 has them (Fling, plus constructor fields)', () => {
    const counts: Record<string, number> = {};
    for (const file of walk(join(SIM_BUILD, 'esm'))) {
      const hits = readFileSync(file, 'utf-8').match(/\.on[A-Z][A-Za-z]*\s*=[^=>]/g);
      if (hits) counts[relative(join(SIM_BUILD, 'esm'), file).replaceAll('\\', '/')] = hits.length;
    }
    expect(counts).toEqual({
      'data/mods/gen4/moves.mjs': 2, 'data/moves.mjs': 2, 'sim/dex-formats.mjs': 4, 'sim/dex-items.mjs': 3,
    });
  });
});

describe('the rebuilt closures', () => {
  test('the minified form compiles and binds to its target', () => {
    const make = new Function(
      'return function () { return [()=>this.getHealth(), ()=>{return{side:this.side.id,secret:this.hp+"/1",shared:"x"}}]; };',
    )() as (this: object) => [() => unknown, () => unknown];
    const source = { side: { id: 'p1' }, hp: 7 };
    const [details, health] = make.call(source);
    const factory = compileClosures({ getFullDetails: details, getHealth: health });
    const target = { side: { id: 'p2' }, hp: 3, getHealth: () => 'target health' };
    const [rebuiltDetails, rebuiltHealth] = factory.call(target) as [() => unknown, () => unknown];
    expect(rebuiltHealth()).toEqual({ side: 'p2', secret: '3/1', shared: 'x' });
    expect(rebuiltDetails.call(null)).toBe('target health'); // arrow: call(null) cannot rebind, `this` stays the target
  });

  test('a closure over a foreign variable fails the self-test and falls back', () => {
    const battle = deserializeFromParsed(parseSearchState(positions[0].serialized));
    const hidden = 'secret';
    for (const side of battle.sides) {
      for (const pokemon of side.pokemon) {
        (pokemon as unknown as Record<string, unknown>).getHealth = () => ({ side: hidden, secret: hidden, shared: hidden });
      }
    }
    resetClosuresForTests();
    configureSimFast(['clone']);
    expect(copyBattle(battle)).toBeNull();
    expect(simFastStatus()).toBe('fallback');
  });
});

describe('the hash gate', () => {
  test('a changed pin: hash-mismatch, standard path, same results; forced, it throws', () => {
    const position = positions[0];
    const play = () => {
      const root = createRootPosition(position.serialized);
      const { child, log } = advancePositionWithLog(root, legalChoices(root, 'p1')[0].choice, legalChoices(root, 'p2')[0].choice, SEEDS[0]);
      return `${child.serialized}\n${stableLog(log)}`;
    };
    const today = withSimFast([], play);
    const falsified = {
      esm: { ...PINNED_SIM_HASHES.esm, 'Battle.runEvent': '00000000' },
      cjs: { ...PINNED_SIM_HASHES.cjs, 'Battle.runEvent': '00000000' },
    };
    // One lever at a time: with all three, the rules gate breaks first and turns the others off before they reach their gate.
    const counter = { rules: 'ruleTables', clone: 'clones', dispatch: 'dispatchCalls' } as const;
    for (const lever of ['rules', 'clone', 'dispatch'] as const) {
      resetSimFastForTests();
      setPinnedHashes(falsified);
      configureSimFast([lever]);
      expect(play(), lever).toBe(today);
      expect(simFastStatus(), lever).toBe('hash-mismatch');
      expect(takeSimFastReport().counters[counter[lever]], lever).toBe(0);
    }
    for (const lever of ['clone', 'dispatch'] as const) {
      resetSimFastForTests();
      setPinnedHashes(falsified);
      configureSimFast([lever], { forced: true });
      expect(play, lever).toThrow(/sim-fast hash-mismatch/);
      expect(play, lever).toThrow(/sim-fast hash-mismatch/); // every use, never a silent standard path after the first throw
    }
  });
});
