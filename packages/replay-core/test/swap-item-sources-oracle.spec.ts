import { describe, expect, test } from 'vitest';
import { fromEffect, readLine } from '../src/inference/log-line';
import { SWAP_ITEM_SOURCES } from '../src/inference/handlers';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 17: `SWAP_ITEM_SOURCES` in inference/handlers.ts names the `[from]` sources of an `|-item|` line that
 * mean the holder took the item from another Pokémon, so the item is not its set item (GPL T11: a Trick scarf hid the real
 * moves). The Dex cannot say it as a field, but the simulator's handlers write those lines, so the spec reads them: every
 * handler (a move's, an ability's, an item's, also inside `secondary`, `self` and `condition`) whose source text emits an `-item`
 * line names its `[from]` effect in a string literal, and the ones that call `takeItem` move an item between two Pokémon. In
 * every view the corpus plays:
 *  - the sources whose handler takes an item are the list, as `type: Name` (the move names Trick, Switcheroo, Thief, Covet and
 *    Bestow, the ability names Magician and Pickpocket), the Generation 2 forms of Thief and Covet included;
 *  - each of them is played (a user with no item, a user with an item, both with items) and the log's `|-item|` line carries the
 *    source in the shape the inference reads, through its own `readLine` and `fromEffect`;
 *  - FINDING W9a: Symbiosis stands in the list but its handler writes `|-activate|` and no `|-item|` line, so the entry never
 *    matches (played in both doubles rule sets);
 *  - FINDING W9b: Pickup (Generation 5 on) writes `|-item|` with `[from] ability: Pickup` for an item it picks up from another
 *    Pokémon, without `takeItem`; the list lacks it.
 * Recycle, Harvest, Frisk and G-Max Replenish write `|-item|` lines too and move no item between Pokémon: they stay out.
 */

const SPEC = 'packages/replay-core/test/swap-item-sources-oracle.spec.ts';

type Entry = Record<string, unknown>;

/** The source text of every function inside an entry (its handlers, those of `secondary`, `self` and `condition`). */
function handlerTexts(value: unknown, depth = 0): string[] {
  if (typeof value === 'function') return [String(value)];
  if (depth > 3 || typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(inner => handlerTexts(inner, depth + 1));
}

interface Emitter { source: string; takes: boolean; id: string; kind: 'move' | 'ability' }

/** Every move and ability of the view with a handler that writes an `-item` line, its `[from]` sources and whether it takes an item. */
function emitters(view: SimView): Emitter[] {
  const found: Emitter[] = [];
  const scan = (kind: 'move' | 'ability', entry: Entry & { id: string; exists: boolean; isNonstandard?: string | null }) => {
    if (!entry.exists || entry.isNonstandard === 'Future') return;
    const texts = handlerTexts(entry).filter(text => /['"]-item['"]/.test(text));
    const takes = texts.some(text => text.includes('takeItem('));
    for (const source of new Set(texts.flatMap(text => [...text.matchAll(/\[from\] (move|ability): ([^'"]+)/g)].map(match => `${match[1]}: ${match[2]}`)))) {
      found.push({ source, takes, id: entry.id, kind });
    }
  };
  for (const move of view.dex.moves.all()) scan('move', move as unknown as Entry & { id: string; exists: boolean });
  for (const ability of view.dex.abilities.all()) scan('ability', ability as unknown as Entry & { id: string; exists: boolean });
  return found;
}

const listed = (): string[] => Object.entries(SWAP_ITEM_SOURCES).flatMap(([type, names]) => [...names].map(name => `${type}: ${name}`)).sort();

const ITEM_ARRANGEMENTS: [string, string][] = [['', 'leftovers'], ['leftovers', ''], ['leftovers', 'quickclaw']];

/** The `[from]` sources of every `|-item|` line the simulator writes when the move or ability plays against the arrangement. */
function observedSources(view: SimView, emitter: Emitter): string[] {
  const seen = new Set<string>();
  for (const [userItem, targetItem] of ITEM_ARRANGEMENTS) {
    const ability = emitter.kind === 'ability' ? emitter.id : 'noability';
    const moves = emitter.kind === 'move' ? [emitter.id, 'splash'] : ['tackle', 'splash'];
    const battle = battleIn(view,
      [mon('Blissey', moves, { item: userItem, ability }), mon('Blissey', ['splash'])],
      [mon('Snorlax', ['splash'], { item: targetItem, ability }), mon('Snorlax', ['splash'])]);
    const aimed = emitter.kind === 'ability' || ['normal', 'any', 'adjacentFoe'].includes(view.dex.moves.get(emitter.id).target);
    battle.choose('p1', view.doubles ? `move 1${aimed ? ' 1' : ''}, move 1` : 'move 1');
    battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
    for (const raw of battle.log) {
      const line = readLine(raw);
      if (line.cmd !== '-item') continue;
      const from = fromEffect(line);
      if (from.type) seen.add(`${from.type}: ${from.name}`);
    }
  }
  return [...seen].sort();
}

describe('SWAP_ITEM_SOURCES is held to the simulator (round 72)', () => {
  test('the list carries its oracle tag', () => {
    expect(oracleTagAbove('packages/replay-core/src/inference/handlers.ts', 'const SWAP_ITEM_SOURCES', SPEC)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const writers = emitters(view);

    test('the handlers that take an item from a Pokémon are the listed sources (Symbiosis aside, Pickup named)', () => {
      const takers = [...new Set(writers.filter(writer => writer.takes).map(writer => writer.source))].sort();
      const expected = listed().filter(name => name !== 'ability: Symbiosis');
      // A source the view has no move or ability for (Generation 2 has no abilities) is not expected.
      const real = expected.filter(name => {
        const [kind, label] = name.split(': ');
        const id = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        return (view.dex[kind === 'move' ? 'moves' : 'abilities'].get(id).isNonstandard ?? null) !== 'Future' && view.dex[kind === 'move' ? 'moves' : 'abilities'].get(id).exists;
      });
      expect(takers).toEqual(real.sort());
    });

    test('each taker is played and its |-item| line carries the source the inference reads', () => {
      const takers = writers.filter(writer => writer.takes);
      if (view.dex.gen >= 2) expect(takers.length).toBeGreaterThan(0); // Generation 1 has no items
      for (const taker of takers) expect(observedSources(view, taker), taker.source).toContain(taker.source);
    });

    test('Pickup writes an |-item| line from another Pokémon and no listed source', () => {
      const pickup = writers.filter(writer => writer.source === 'ability: Pickup');
      expect(pickup.length > 0).toBe(view.dex.gen >= 5); // before Generation 5 Pickup finds items between battles
      expect(listed()).not.toContain('ability: Pickup');
      for (const writer of pickup) expect(writer.takes).toBe(false);
    });
  });

  describe.each(ALL_VIEWS.filter(view => view.doubles))('$name: Symbiosis', view => {
    test('hands an item over through |-activate| and writes no |-item| line', () => {
      const battle = battleIn(view,
        [mon('Blissey', ['splash'], { item: 'sitrusberry' }), mon('Blissey', ['splash'], { item: 'leftovers', ability: 'symbiosis' })],
        [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      battle.sides[0].active[0].hp = Math.floor(battle.sides[0].active[0].maxhp / 3);
      battle.choose('p1', 'move 1, move 1');
      battle.choose('p2', 'move 1, move 1');
      const lines = battle.log.map(readLine);
      expect(lines.some(line => line.cmd === '-activate' && line.raw.includes('ability: Symbiosis'))).toBe(true);
      expect(lines.filter(line => line.cmd === '-item' && fromEffect(line).name === 'Symbiosis')).toEqual([]);
      expect(listed()).toContain('ability: Symbiosis');
    });
  });
});
