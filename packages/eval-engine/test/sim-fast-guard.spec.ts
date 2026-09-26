import * as esm from '@pkmn/sim';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import { forkBattle } from '../src/forward/position';
import { restoreSideInvariants, serializeBattleStable } from '../src/forward/serialize';
import { resetClosuresForTests, sharedClasses } from '../src/forward/sim-fast/clone';
import { compileClosures } from '../src/forward/sim-fast/clone-plan';
import { hashSources, PINNED_SIM_HASHES, setPinnedHashes } from '../src/forward/sim-fast/guard';
import { copyBattle, setTemplateHook } from '../src/forward/sim-fast/index';
import { configureSimFast, resetSimFastForTests, simFastStatus, takeSimFastReport } from '../src/forward/sim-fast/state';
import { loadPositions, ownKeyLists, SEEDS, stableLog, withSimFast } from './sim-fast-helpers';

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

const TEAM = esm.Teams.pack([
  { name: 'A', species: 'Pikachu', item: '', ability: 'Static', moves: ['thunderbolt'], nature: 'Hardy', evs: {}, ivs: {}, level: 50, gender: '' },
  { name: 'B', species: 'Eevee', item: '', ability: 'Run Away', moves: ['tackle'], nature: 'Hardy', evs: {}, ivs: {}, level: 50, gender: '' },
] as unknown as esm.PokemonSet[]);

function twoBattles(formatid: string): [esm.Battle, esm.Battle] {
  const make = () => new esm.Battle({ formatid: esm.toID(formatid), seed: '1,2,3,4', p1: { name: 'x', team: TEAM }, p2: { name: 'y', team: TEAM } });
  return [make(), make()];
}

/** Undefined writes whose receiver is no Battle, Field, Side or Pokemon ("<file> <receiver>"). */
const NOT_BATTLE_STATE = new Set([
  'sim/side.mjs req', // an entry of side.activeRequest, which today's fork rebuilds (state.mjs:112-126)
  'sim/team-validator.mjs this', // the TeamValidator
]);

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

const CENSUS_FORMATS = ['gen1customgame', 'gen2customgame', 'gen3customgame', 'gen4customgame', 'gen5customgame', 'gen6customgame',
  'gen7customgame', 'gen8customgame', 'gen9customgame', 'gen9doublescustomgame'];

type Member = [species: string, item: string, moves: string[]];
/**
 * Items to steal and swap (Thief, Trick), a berry and Leftovers, Rollout and
 * the moves that call it through another move (Mirror Move, Metronome),
 * Explosion for mid-turn replacements. Each gen keeps the moves and items it
 * has (gen 1 has no items).
 */
const CENSUS_SIDES: [Member[], Member[]] = [
  [['Mew', '', ['Thief', 'Trick', 'Mirror Move', 'Metronome']], ['Clefable', 'Sitrus Berry', ['Metronome', 'Trick', 'Body Slam', 'Thief']],
    ['Chansey', 'Leftovers', ['Soft-Boiled', 'Seismic Toss', 'Mirror Move', 'Thief']]],
  [['Snorlax', 'Leftovers', ['Rollout', 'Body Slam', 'Thief', 'Rest']], ['Golem', 'Sitrus Berry', ['Rollout', 'Explosion', 'Earthquake', 'Trick']],
    ['Pidgeot', 'Choice Scarf', ['Mirror Move', 'Double-Edge', 'Thief', 'Quick Attack']]],
];

function censusRoot(formatid: string): string {
  const dex = esm.Dex.forFormat(esm.Dex.formats.get(formatid));
  const has = (effect: { exists: boolean; gen: number }) => effect.exists && effect.gen <= dex.gen;
  const team = (members: Member[]) => esm.Teams.pack(members.map(([species, item, moves]) => ({
    name: species, species, item: has(dex.items.get(item)) ? item : '', ability: 'No Ability', moves: moves.filter(move => has(dex.moves.get(move))),
    nature: 'Hardy', gender: '', evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 },
    ivs: { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 }, level: 100,
  })) as unknown as esm.PokemonSet[]);
  const battle = new esm.Battle({
    formatid: esm.toID(formatid), seed: '1,2,3,4', p1: { name: 'Alpha', team: team(CENSUS_SIDES[0]) }, p2: { name: 'Beta', team: team(CENSUS_SIDES[1]) },
  });
  expect(battle.format.exists, formatid).toBe(true);
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 123');
    battle.choose('p2', 'team 123');
  }
  return JSON.stringify(esm.State.serializeBattle(battle));
}

interface CensusTally { forks: number; templates: number; snapshots: number; mismatches: string[] }

/** Where two lists first differ, with a little context. */
function firstDifference(today: readonly string[], copied: readonly string[]): string {
  let index = 0;
  while (index < Math.max(today.length, copied.length) && today[index] === copied[index]) index++;
  const [a, b] = [today[index] ?? '<none>', copied[index] ?? '<none>'];
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return `#${index}: today ...${a.slice(Math.max(0, at - 60), at + 60)} | copy ...${b.slice(Math.max(0, at - 60), at + 60)}`;
}

/** Every copy source (position template, mid-turn snapshot): a copy of it against today's round trip of it. */
function censusTemplate(template: esm.Battle, tally: CensusTally): void {
  tally.templates++;
  if (template.sides.some(side => side.requestState === 'switch')) tally.snapshots++;
  const copy = copyBattle(template)!;
  // A template has no PRNG (a fork seeds its copy); the round trip serializes a seeded copy, same state otherwise.
  copy.prng = new esm.PRNG('1,2,3,4');
  const today = ownKeyLists(deserializeFromParsed(parseSearchState(serializeBattleStable(copy))));
  restoreSideInvariants(copy);
  const copied = ownKeyLists(copy);
  if (copied.join('\n') !== today.join('\n')) tally.mismatches.push(`${template.format.id} template: ${firstDifference(today, copied)}`);
}

/** A few plies, the same picks with the lever clone and without: every fork's own keys and every child as today. */
function censusPlayout(label: string, root: string, seed: (typeof SEEDS)[number], pick: number, tally: CensusTally): void {
  let copied = createRootPosition(root);
  let today = createRootPosition(root);
  for (let ply = 0; ply < 5; ply++) {
    const forked = withSimFast(['clone'], () => ownKeyLists(forkBattle(copied, seed)));
    const expected = withSimFast([], () => ownKeyLists(forkBattle(today, seed)));
    tally.forks++;
    if (forked.join('\n') !== expected.join('\n')) tally.mismatches.push(`${label} ply ${ply} fork: ${firstDifference(expected, forked)}`);
    if (positionBattle(today).ended) return;
    const [a, b] = (['p1', 'p2'] as const).map((side, index) => {
      const options = legalChoices(today, side);
      return options.length > 0 ? options[(pick * 7 + ply * 3 + index) % options.length].choice : 'wait';
    });
    const next = withSimFast(['clone'], () => advancePositionWithLog(copied, a, b, seed));
    const standard = withSimFast([], () => advancePositionWithLog(today, a, b, seed));
    if (next.child.serialized !== standard.child.serialized || stableLog(next.log) !== stableLog(standard.log)) {
      tally.mismatches.push(`${label} ply ${ply} child: ${firstDifference([standard.child.serialized], [next.child.serialized])}`);
    }
    [copied, today] = [next.child, standard.child];
  }
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

  test('every constructor key the sim empties by name holds undefined on a fresh object, in every gen', () => {
    // Today's round trip drops a key holding undefined and leaves the constructor's value; a copy keeps
    // undefined. adoptTemplate (sim-fast/index.ts) relies on the two agreeing for constructor keys.
    // A source scan sees only literal writes (gen 2's lastMoveTargetLoc = targetLoc it cannot see):
    // the census below plays the rest.
    const esmDir = join(SIM_BUILD, 'esm');
    const sources = [...readdirSync(join(esmDir, 'sim')).filter(name => name.endsWith('.mjs')).map(name => join(esmDir, 'sim', name)),
      ...walk(join(esmDir, 'data'))];
    const emptied = new Set<string>();
    for (const file of sources) {
      const where = relative(esmDir, file).replaceAll('\\', '/');
      for (const [, receiver, key] of readFileSync(file, 'utf-8').matchAll(/([\w$]+|\])\.([\w$]+)\s*=\s*(?:undefined|void 0)\b/g)) {
        if (!NOT_BATTLE_STATE.has(`${where} ${receiver}`)) emptied.add(key);
      }
    }
    const kept: string[] = [];
    for (const formatid of CENSUS_FORMATS) {
      const fresh = new esm.Battle({
        formatid: esm.toID(formatid), seed: '1,2,3,4', deserialized: true, p1: { name: 'x', team: TEAM }, p2: { name: 'y', team: TEAM },
      });
      expect(fresh.format.exists, formatid).toBe(true);
      for (const object of [fresh, fresh.field, ...fresh.sides.flatMap(side => [side, ...side.pokemon])]) {
        const record = object as unknown as Record<string, unknown>;
        for (const key of emptied) if (Object.hasOwn(record, key) && record[key] !== undefined) kept.push(`${formatid} ${key}`);
      }
    }
    expect(kept).toEqual([]);
    expect([...emptied].sort()).toContain('moveThisTurnResult'); // the scan still reads the sources
  });

  test('census: in every gen a copy source forks with today\'s own keys and plays as today (singles and doubles)', () => {
    const tally: CensusTally = { forks: 0, templates: 0, snapshots: 0, mismatches: [] };
    setTemplateHook(template => censusTemplate(template, tally));
    try {
      for (const formatid of CENSUS_FORMATS) {
        const root = censusRoot(formatid);
        for (const seed of SEEDS) {
          for (let pick = 0; pick < 3; pick++) censusPlayout(`${formatid} ${seed} pick ${pick}`, root, seed, pick, tally);
        }
      }
    } finally {
      setTemplateHook(null);
    }
    expect(tally.mismatches).toEqual([]);
    expect(tally.forks).toBeGreaterThan(CENSUS_FORMATS.length * 2 * 3);
    expect(tally.snapshots).toBeGreaterThan(0);
  }, 120_000);
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
