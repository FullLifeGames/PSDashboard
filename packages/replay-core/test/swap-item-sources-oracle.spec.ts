import { describe, expect, test } from 'vitest';
import { arg, fromEffect, kwText, readLine } from '../src/inference/log-line';
import { ITEM_HANDOVER_ACTIVATIONS, SWAP_ITEM_SOURCES } from '../src/inference/handlers';
import { inferOpponentTeam } from '../src/opponent-inferrer';
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
 *  - FINDING W9a: Symbiosis hands an item over with `|-activate|<giver>|ability: Symbiosis|<item>|[of] <receiver>` and writes no
 *    `|-item|` line, so it is no entry of the `-item` list; `ITEM_HANDOVER_ACTIVATIONS` names it for the inference, which credits
 *    the giver's set item and marks the receiver as having been handed an item (played in both doubles rule sets);
 *  - FINDING W9b: Pickup (Generation 5 on) writes `|-item|` with `[from] ability: Pickup` for an item it picks up from another
 *    Pokémon, without `takeItem`; the list names it, so the picker's item is not read as its set item.
 * Recycle, Harvest, Frisk and G-Max Replenish write `|-item|` lines too and move no item between Pokémon: they stay out.
 */

const SPEC = 'packages/replay-core/test/swap-item-sources-oracle.spec.ts';

type Entry = Record<string, unknown>;

/** The log as a spectator reads it: the line after a |split| marker is the owner's private copy, left out. */
const publicLog = (log: string[]) => log.filter((line, index) => !line.startsWith('|split|') && !log[index - 1]?.startsWith('|split|'));

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

/** Listed sources whose handler moves an item without `takeItem` (the ground, not a Pokémon's hands). */
const PICKS_UP = ['ability: Pickup'];

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

    test('the handlers that take an item from a Pokémon are the listed sources (Pickup picks up without taking)', () => {
      const takers = [...new Set(writers.filter(writer => writer.takes).map(writer => writer.source))].sort();
      const expected = listed().filter(name => !PICKS_UP.includes(name));
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

    test('Pickup writes an |-item| line without takeItem, and the list names it', () => {
      const pickup = writers.filter(writer => writer.source === 'ability: Pickup');
      expect(pickup.length > 0).toBe(view.dex.gen >= 5); // before Generation 5 Pickup finds items between battles
      if (view.dex.gen >= 5) expect(listed()).toContain('ability: Pickup');
      for (const writer of pickup) expect(writer.takes).toBe(false);
    });
  });

  describe.each(ALL_VIEWS.filter(view => view.doubles))('$name: Symbiosis', view => {
    const scene = () => {
      const battle = battleIn(view,
        [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])],
        [mon('Blissey', ['splash'], { item: 'sitrusberry', name: 'Receiver' }), mon('Oranguru', ['splash'], { item: 'leftovers', ability: 'symbiosis', name: 'Giver' })]);
      battle.sides[1].active[0].hp = Math.floor(battle.sides[1].active[0].maxhp / 3);
      for (let turn = 0; turn < 2; turn++) { battle.choose('p1', 'move 1, move 1'); battle.choose('p2', 'move 1, move 1'); }
      return publicLog(battle.log);
    };

    test('hands an item over through |-activate| and writes no |-item| line', () => {
      const lines = scene().map(readLine);
      const handover = lines.find(line => line.cmd === '-activate' && line.raw.includes('ability: Symbiosis'));
      expect(handover).toBeDefined();
      expect(lines.filter(line => line.cmd === '-item' && fromEffect(line).name === 'Symbiosis')).toEqual([]);
      expect(listed()).not.toContain('ability: Symbiosis');
      expect([...ITEM_HANDOVER_ACTIVATIONS.ability]).toEqual(['Symbiosis']);
      expect(arg(handover!, 2)).toBe('ability: Symbiosis');
      expect(kwText(handover!, 'item')).toBe('Leftovers');
    });

    test('the inference credits the giver with the item the handover names', () => {
      const team = inferOpponentTeam(scene().join('\n'), 'p2').pokemon;
      expect(team.find(pokemon => pokemon.species === 'Oranguru')?.item.value).toBe('Leftovers');
      expect(team.find(pokemon => pokemon.species === 'Blissey')?.item.value).toBe('Sitrus Berry (consumed)');
    });
  });

  describe.each(ALL_VIEWS.filter(view => view.dex.gen >= 5))('$name: Pickup', view => {
    test("an item Pickup took from another Pokémon is not the picker's set item", () => {
      // Doubles: the eater is the picker's partner. Singles: the eater is the foe, the picker acts on the other side.
      const picker = mon('Zigzagoon', ['splash'], { ability: 'pickup', name: 'Picker' });
      const eater = mon('Blissey', ['splash'], { item: 'sitrusberry', name: 'Eater' });
      const battle = view.doubles
        ? battleIn(view, [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])], [picker, eater])
        : battleIn(view, [eater], [picker]);
      (view.doubles ? battle.sides[1].active[1] : battle.sides[0].active[0]).hp = Math.floor(battle.sides[0].active[0].maxhp / 3);
      battle.choose('p1', view.doubles ? 'move 1, move 1' : 'move 1');
      battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
      const log = publicLog(battle.log);
      expect(log.some(raw => /^\|-item\|.*\[from\] ability: Pickup/.test(raw)), 'Pickup picked the berry up').toBe(true);
      const team = inferOpponentTeam(log.join('\n'), 'p2').pokemon;
      expect(team.find(pokemon => pokemon.species === 'Zigzagoon')?.item.value ?? '').toBe('');
    });
  });
});
