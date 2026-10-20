import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { advancePosition, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { isolated } from '../src/sim-ask';
import { protectorStops } from '../src/search/hints';
import { loadPositions, withSimFast } from './sim-fast-helpers';

/**
 * Round 72 (T256): a question to the simulator leaves nothing behind. The browser feedback run of gen9vgc2026regi-2630685175
 * lost its renderer to an out-of-memory exit in 3 of 6 attempts once the Protect hint asked through views. Cause: the
 * speed layer (forward/sim-fast/dispatch.ts) keeps a Map from an effect object (a body's base species, the battle's format) to
 * the event handlers it carries, in a table that lives as long as the Dex. A view of the species or the format is a new object
 * on every question, so every question added its views, with the graph behind them, to that table for good: 5 to 8 KB per
 * question here, 22 KB in a search (100 MB over the 4,500 questions of one position). Game data (a species, a format, a move, an ability, an item, a condition) reaches the handler as itself; a
 * body, a side, the field and the active move stay views.
 */

v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc') as () => void;
const heapMb = () => { collect(); collect(); return process.memoryUsage().heapUsed / 1048576; };

const LEVERS = ['rules', 'clone', 'dispatch'] as const;
/** One singles position, one Scarlet/Violet doubles position, one VGC position and the Champions VGC position of the fixtures. */
const SCENES = ['gen9ou-2658658993#2', 'gen9doublesou-2660802611#2', 'gen9vgc2026regi-2630685175#7', 'gen9championsvgc2026regmbbo3-2634199230#5'];

/** The first line of every side one, played against the first line of every side two: a fresh child battle per call. */
function childBattle(serialized: string): Battle {
  const root = createRootPosition(serialized, 'standard' as never);
  const mine = legalChoices(root, 'p1', { tera: false } as never)[0];
  const theirs = legalChoices(root, 'p2', { tera: false } as never)[0];
  return positionBattle(advancePosition(root, mine.choice, theirs.choice, [1, 2, 3, 4] as never));
}

function ask(battle: Battle): void {
  const [source, target] = [battle.sides[0].active[0], battle.sides[1].active[0]] as (Pokemon | undefined)[];
  if (!source || !target) return;
  protectorStops(battle, battle.dex.moves.get('protect'), battle.dex.getActiveMove('tackle'), source, target);
}

describe.each(SCENES)('questions to the simulator leave no heap behind (round 72, T256): %s', id => {
  const position = loadPositions().find(candidate => candidate.id === id);

  test('the scene is in the fixtures', () => {
    expect(position).toBeDefined();
  });

  test('300 Protect questions on fresh child battles keep the heap where it was', () => {
    if (!position) return;
    withSimFast([...LEVERS], () => {
      for (let round = 0; round < 30; round++) ask(childBattle(position.serialized));
      const before = heapMb();
      for (let round = 0; round < 300; round++) ask(childBattle(position.serialized));
      expect(heapMb() - before).toBeLessThan(0.5);
    });
  }, 120_000);
});

describe('a view keeps game data as itself (round 72, T256)', () => {
  const position = loadPositions().find(candidate => candidate.id === 'gen9doublesou-2660802611#2')!;

  test('species, format, ability and item come through the view unchanged; bodies, sides and moves do not', () => {
    withSimFast([...LEVERS], () => {
      const battle = childBattle(position.serialized);
      const live = battle.sides[0].active[0]!;
      const view = isolated(battle);
      const body = view.sides[0].active[0]!;
      expect(body === live).toBe(false);
      expect(view.sides[0] === battle.sides[0]).toBe(false);
      expect(view.field === battle.field).toBe(false);
      expect(body.baseSpecies === live.baseSpecies).toBe(true);
      expect(body.species === live.species).toBe(true);
      expect(view.format === battle.format).toBe(true);
      const attack = battle.dex.getActiveMove('tackle');
      expect(isolated(attack) === attack).toBe(false);
    });
  });
});

/** The Dex entries of one rule set, by kind; the Dex is the one a battle of the rule set holds. */
function entriesOf(dex: Battle['dex']): { kind: string; entry: object }[] {
  const rows: { kind: string; entry: object }[] = [];
  const add = (kind: string, entries: readonly object[]) => { for (const entry of entries) rows.push({ kind, entry }); };
  add('species', dex.species.all().filter(entry => entry.exists));
  add('moves', dex.moves.all().filter(entry => entry.exists));
  add('abilities', dex.abilities.all().filter(entry => entry.exists));
  add('items', dex.items.all().filter(entry => entry.exists));
  add('natures', dex.natures.all());
  add('conditions', Object.keys(dex.data.Conditions).map(id => dex.conditions.get(id)).filter(entry => entry.exists));
  return rows;
}

describe('every Dex entry reaches a handler as itself, every copy of one as a view (round 72, T256)', () => {
  const position = loadPositions().find(candidate => candidate.id === 'gen9doublesou-2660802611#2')!;
  const champions = loadPositions().find(candidate => candidate.id === 'gen9championsvgc2026regmbbo3-2634199230#5')!;

  test.each([['Scarlet/Violet', position], ['Pokémon Champions', champions]] as const)('%s', (_name, scene) => {
    const dex = childBattle(scene.serialized).dex;
    const all = entriesOf(dex);
    // Hidden Power is one id with a typed entry per type; the Dex returns the plain one for the id, so a battle never holds the others.
    const lookup = (kind: string, id: string) => ((dex as unknown as Record<string, { get(id: string): unknown }>)[kind]).get(id);
    const rows = all.filter(row => lookup(row.kind, (row.entry as { id: string }).id) === row.entry);
    expect(all.length - rows.length).toBeLessThan(20);
    expect(all.filter(row => !rows.includes(row)).every(row => (row.entry as { id: string }).id === 'hiddenpower')).toBe(true);
    expect(rows.length).toBeGreaterThan(2000);
    const holder = { dex, entries: rows.map(row => row.entry), copies: rows.map(row => Object.assign(Object.create(Object.getPrototypeOf(row.entry) as object | null) as object, row.entry)) };
    const view = isolated(holder);
    const passed = rows.filter((_row, index) => view.entries[index] === holder.entries[index]).length;
    const copiesWrapped = rows.filter((_row, index) => view.copies[index] !== holder.copies[index]).length;
    expect({ passed, copiesWrapped }).toEqual({ passed: rows.length, copiesWrapped: rows.length });
  });
});
