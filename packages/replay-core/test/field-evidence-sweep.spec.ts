import { describe, expect, test } from 'vitest';
import { conditionTurns, startsForGood } from '../src/dex-facts/screen-turns';
import type { RulesDex } from '../src/rules-dex';
import { RULE_VIEWS, proven, ruledOut, type Holder, type Side } from './screen-scenes';
import { cleanEnd, fieldLines, playField, type FieldLine, type FieldSceneOptions } from './field-scenes';
import type { SimView } from './sim-views';

/**
 * Round 88 (T329, GitHub issue #65): the turns of a weather or a terrain name the item that held it. Sunny Day lasts five turns,
 * eight with Heat Rock; Rain Dance with Damp Rock, Sandstorm with Smooth Rock, Hail and Snowscape with Icy Rock, the four
 * terrains with Terrain Extender. The log shows the start and the end of the field (`-weather`, `-fieldstart`, then
 * `-weather|none` or `-fieldend` in the residual phase) but never the item, so the inference reads the field's lifetime and holds
 * it to the Dex's own turns (`conditionTurns`, held to the simulator by `screen-turns-sweep.spec.ts`), in every rule set the
 * corpus plays (Generations 3 to 9 and the Champions mod; Generation 4 on gives the items) and both game types:
 *  - the plain five turns rule the items out for the setter, the turns of one item prove it;
 *  - the setter is the user of the move, or the `[of]` body of an ability's start (found by playing every ability of the
 *    rule set, never by its name);
 *  - nothing is read when the turns prove nothing: a field that never ends in the residual phase (abilities set it for good
 *    before Generation 6), a removal, a replacement (a terrain's replacement prints only the new start), an item that did not
 *    count (Klutz, Embargo, Magic Room), an item the log showed change, an Illusion team.
 * The oracle is the scene: the item the setter holds says what the turns must read, and `cleanEnd` (the log shows the field
 * standing from its start to its own end in the residual phase) says when a verdict may exist. A log that ends cleanly must
 * give exactly the verdict of the held item; every other log must give none.
 */

const FULL = process.env.DICE_SWEEPS === 'full';
const asRulesDex = (view: SimView): RulesDex => view.dex as unknown as RulesDex;
const slotsOf = (view: SimView): (0 | 1)[] => (view.doubles ? [0, 1] : [0]);
const SNORLAX = 'Snorlax';
const TURNS = 12;

type DexMove = ReturnType<SimView['dex']['moves']['get']>;
const legal = (view: SimView, move: DexMove): boolean => move.exists && move.gen <= view.dex.gen && !move.isZ && !move.isMax
  && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past');

const isTerrainOf = (view: SimView) => (id: string): boolean => view.dex.conditions.get(id).effectType === 'Terrain';
const linesOf = (view: SimView, log: string): FieldLine[] => fieldLines(log, isTerrainOf(view));

/** The moves of a rule set that set a weather or a terrain, with the condition and its kind. */
function fieldMoves(view: SimView): { move: string; condition: string; kind: FieldLine['kind'] }[] {
  return view.dex.moves.all().filter(move => legal(view, move) && (move.weather || move.terrain)).map(move => {
    const condition = view.dex.conditions.get((move.weather ?? move.terrain)!).id;
    return { move: move.id, condition, kind: move.terrain ? 'terrain' as const : 'weather' as const };
  });
}

const known = (view: SimView, ids: string[]): string[] => ids.filter(id => legal(view, view.dex.moves.get(id)));

/** The items that change a condition's turns in the rule set: id and name. */
function itemsOf(view: SimView, condition: string): { id: string; name: string }[] {
  const table = conditionTurns(asRulesDex(view), condition);
  return [...(table?.byItem.keys() ?? [])].map(id => ({ id, name: view.dex.items.get(id).name }));
}

/**
 * The verdict of a log against the scene: a log that ends cleanly gives the held item's verdict, every other log gives none.
 * Returns whether the log ended cleanly, so a row can also insist that it did.
 */
function expectVerdict(view: SimView, log: string, scene: { kind: FieldLine['kind']; condition: string; side: Side; species: string; held?: string }, sound = false): boolean {
  const items = itemsOf(view, scene.condition);
  const clean = cleanEnd(linesOf(view, log), scene.kind, scene.side, scene.side) !== null;
  const ruled = items.filter(item => ruledOut(log, scene.side, scene.species, item.id)).map(item => item.id).sort();
  const shown = proven(log, scene.side, scene.species);
  const label = `${scene.condition} held ${scene.held ?? 'nothing'}`;
  const held = items.find(item => item.name === scene.held);
  if (sound && clean) {
    // a move that shows an item (Trick, Knock Off) lets the reader abstain; it must never read a wrong item
    // the item evidence also writes "(consumed)" after a Fling that threw the item
    expect(shown === '' || (!!held && shown.startsWith(held.name)), `${label}: proven ${shown}`).toBe(true);
    if (held) expect(ruled, `${label}: ruled out`).not.toContain(held.id);
    return clean;
  }
  if (!clean || items.length === 0) {
    expect(ruled, `${label}: ruled out`).toEqual([]);
    expect(shown, `${label}: proven`).toBe('');
    return clean;
  }
  if (held) {
    expect(shown, `${label}: proven`).toBe(held.name);
    expect(ruled, `${label}: ruled out`).toEqual([]);
  } else {
    expect(ruled, `${label}: ruled out`).toEqual(items.map(item => item.id).sort());
    expect(shown, `${label}: proven`).toBe('');
  }
  return clean;
}

const played = (view: SimView, options: FieldSceneOptions): string => {
  const log = playField(view, options);
  if (!log) throw new Error(`the scene cannot be played: ${JSON.stringify(options)}`);
  return log;
};

/** Every ability of the rule set that starts a weather or a terrain, found by playing it as the lead (the foe's Tackle also reaches the abilities that answer a hit). */
const abilityCache = new Map<string, { id: string; kind: FieldLine['kind']; condition: string }[]>();
function abilitySetters(view: SimView): { id: string; kind: FieldLine['kind']; condition: string }[] {
  const cached = abilityCache.get(view.name);
  if (cached) return cached;
  const found: { id: string; kind: FieldLine['kind']; condition: string }[] = [];
  for (const ability of view.dex.abilities.all()) {
    if (!ability.exists || ability.gen > view.dex.gen) continue;
    let log: string | null;
    try {
      log = playField(view, { p1: { species: SNORLAX, ability: ability.name }, moves2: { 1: 'tackle' }, turns: 1 });
    } catch { continue; }
    if (!log) continue;
    const start = linesOf(view, log).find(line => line.op === 'start' && line.side === 'p1');
    if (start) found.push({ id: ability.id, kind: start.kind, condition: start.id });
  }
  abilityCache.set(view.name, found);
  return found;
}

/** The abilities a rule set must find (the oracle's own list, with the generation each debuts in): the sweep proves it plays them. */
const NAMED_ABILITIES: [string, number][] = [['drought', 3], ['drizzle', 3], ['sandstream', 3], ['snowwarning', 4], ['electricsurge', 7], ['grassysurge', 7], ['mistysurge', 7], ['psychicsurge', 7], ['sandspit', 8], ['seedsower', 9]];

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 3))('S5, the setter of a move: $name', view => {
  const setters = fieldMoves(view);

  test('the rule set has weather moves', () => {
    expect(setters.length).toBeGreaterThan(0);
    expect(setters.some(entry => entry.kind === 'weather')).toBe(true);
  });

  for (const { move, condition, kind } of setters) {
    const table = itemsOf(view, condition);
    for (const slot of slotsOf(view)) {
      for (const held of [undefined, ...table.map(item => item.name)]) {
        test(`${move}, ${held ?? 'no item'}${view.doubles ? `, slot ${slot + 1}` : ''}: the lifetime reads the item`, () => {
          const log = played(view, { p1: { species: SNORLAX, item: held }, moves1: { 1: move }, turns: TURNS, slot, style: held ? 'plain' : 'timed' });
          const clean = expectVerdict(view, log, { kind, condition, side: 'p1', species: SNORLAX, held });
          expect(clean, 'the log shows the field ending cleanly').toBe(true);
        });
      }
    }
  }
});

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 3))('S6, the setter of an ability: $name', view => {
  const found = abilitySetters(view);

  test('the sweep found the abilities the rule set has', () => {
    for (const [named, since] of NAMED_ABILITIES) {
      if (view.dex.gen >= since) expect(found.map(entry => entry.id), named).toContain(named);
    }
  });

  for (const { id, kind, condition } of found) {
    const table = itemsOf(view, condition);
    for (const slot of slotsOf(view)) {
      for (const held of [undefined, ...table.map(item => item.name)]) {
        test(`${id}, ${held ?? 'no item'}${view.doubles ? `, slot ${slot + 1}` : ''}: the lifetime reads the item`, () => {
          const log = played(view, { p1: { species: SNORLAX, ability: view.dex.abilities.get(id).name, item: held }, moves2: { 1: 'tackle' }, turns: TURNS, slot });
          const clean = expectVerdict(view, log, { kind, condition, side: 'p1', species: SNORLAX, held });
          // an ability sets a weather for good before Generation 6, and a primal weather stands until its setter leaves: no move of
          // the rule set sets that condition, so the Dex has no turns for it
          const finite = view.dex.gen >= 6 && fieldMoves(view).some(entry => entry.condition === condition);
          expect(clean, finite ? 'the log shows the field ending cleanly' : 'the field stands for good').toBe(finite);
        });
      }
    }
  }
});

/** The cases where the turns prove nothing: each plays the control (a verdict) and then the cause. */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4))('S7, the turns prove nothing: $name', view => {
  const cases = [
    { move: 'sunnyday', kind: 'weather' as const },
    { move: 'electricterrain', kind: 'terrain' as const },
  ].filter(entry => known(view, [entry.move]).length > 0).map(entry => ({ ...entry, condition: view.dex.conditions.get(view.dex.moves.get(entry.move).weather ?? view.dex.moves.get(entry.move).terrain!).id }));
  const slot = view.doubles ? 1 : 0;

  for (const { move, kind, condition } of cases) {
    const rock = itemsOf(view, condition)[0];
    if (!rock) continue;
    const scene = (extra: Partial<FieldSceneOptions> = {}, holder: Holder = { species: SNORLAX, item: rock.name }): string =>
      played(view, { p1: holder, moves1: { 2: move }, turns: TURNS, slot, ...extra });
    const verdict = (log: string, species = SNORLAX, held: string | undefined = rock.name) => expectVerdict(view, log, { kind, condition, side: 'p1', species, held });

    test(`${move}: the control, a holder with ${rock.name} proves it`, () => {
      const log = scene();
      expect(verdict(log)).toBe(true);
      expect(proven(log, 'p1', SNORLAX)).toBe(rock.name);
    });

    test(`${move}: Klutz makes the item count for nothing, five turns with ${rock.name} in hand and no verdict`, () => {
      const log = scene({}, { species: 'Lopunny', item: rock.name, ability: 'Klutz' });
      expect(cleanEnd(linesOf(view, log), kind, 'p1', 'p1')).not.toBeNull();
      expect(ruledOut(log, 'p1', 'Lopunny', rock.id)).toBe(false);
      expect(proven(log, 'p1', 'Lopunny')).toBe('');
    });

    test.each([['embargo', 4], ['magicroom', 5]] as [string, number][])(`${move}: %s makes the item count for nothing, no verdict`, (cause, since) => {
      if (view.dex.gen < since || known(view, [cause]).length === 0) return;
      const log = scene({ moves2: { 1: cause } });
      expect(cleanEnd(linesOf(view, log), kind, 'p1', 'p1')).not.toBeNull();
      expect(ruledOut(log, 'p1', SNORLAX, rock.id)).toBe(false);
      expect(proven(log, 'p1', SNORLAX)).toBe('');
    });

    test(`${move}: an Illusion user on the team, no verdict (where the generation has Illusion)`, () => {
      const illusion = view.dex.abilities.get('illusion');
      const has = illusion.exists && illusion.gen <= view.dex.gen;
      const log = scene({ bench: [{ species: 'Zoroark', ability: 'Illusion' }] }, { species: SNORLAX });
      expect(ruledOut(log, 'p1', SNORLAX, rock.id)).toBe(!has);
    });

    test(`${move}: an item knocked off before the field, no rule-out`, () => {
      const log = scene({ moves2: { 1: 'knockoff' } });
      expect(ruledOut(log, 'p1', SNORLAX, rock.id)).toBe(false);
    });

    test(`${move}: an item swapped by Trick before the field, no rule-out`, () => {
      const log = scene({ moves2: { 1: 'trick' }, p2: { species: 'Vaporeon', item: 'Leftovers' } }, { species: SNORLAX, item: rock.name });
      expect(ruledOut(log, 'p1', SNORLAX, rock.id)).toBe(false);
    });

    test(`${move}: a field still standing at the log's end proves nothing`, () => {
      const log = scene({ turns: 3 }, { species: SNORLAX });
      expect(cleanEnd(linesOf(view, log), kind, 'p1', 'p1')).toBeNull();
      expect(ruledOut(log, 'p1', SNORLAX, rock.id)).toBe(false);
    });
  }

  test('a replacement ends the field outside the residual phase: no verdict for the first setter', () => {
    for (const [first, second, kind] of [['sunnyday', 'raindance', 'weather'], ['electricterrain', 'grassyterrain', 'terrain']] as const) {
      if (known(view, [first, second]).length < 2) continue;
      const condition = view.dex.conditions.get(view.dex.moves.get(first).weather ?? view.dex.moves.get(first).terrain!).id;
      if (itemsOf(view, condition).length === 0) continue;
      const log = played(view, { p1: { species: SNORLAX }, moves1: { 1: first }, p2: { species: 'Vaporeon' }, moves2: { 4: second }, turns: TURNS, slot });
      expect(cleanEnd(linesOf(view, log), kind, 'p1', 'p1'), `${first} then ${second}`).toBeNull();
      for (const item of itemsOf(view, condition)) expect(ruledOut(log, 'p1', SNORLAX, item.id), `${first} then ${second}: ${item.id}`).toBe(false);
      // the first field would read eight turns if the reader let it live on to the second one's end
      expect(proven(log, 'p1', SNORLAX), `${first} then ${second}`).toBe('');
    }
  });
});

/**
 * S8, the removers and the silent movers, found by playing every move of the rule set against a board with a weather and a
 * terrain standing (p1's Sunny Day with the rock and p2's Electric Terrain with Terrain Extender, both on turn 1), p1 playing the move on turn 5, the
 * last turn a plain field stands. A
 * log whose field ended cleanly must read the held item (a log that shows an item change may abstain, never read a wrong one), a log whose field was removed, replaced or moved must read
 * none: the oracle is `cleanEnd`, so a move that ends or changes the field with no line the reader knows fails here. The plain
 * run plays every tenth move and the moves whose Dex entry mentions a weather or a terrain; `DICE_SWEEPS=full` plays them all.
 */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4 && itemsOf(view, 'sunnyday').length > 0))('S8, removers and movers of weather and terrain: $name', view => {
  const rock = itemsOf(view, 'sunnyday')[0];
  const extender = known(view, ['electricterrain']).length > 0 ? itemsOf(view, 'electricterrain')[0] : undefined;
  const textOf = (move: DexMove): string => { try { return JSON.stringify(move, (_key, value) => (typeof value === 'function' ? String(value) : value)); } catch { return ''; } };
  const candidates = view.dex.moves.all().filter(legal.bind(null, view)).filter((move, index) => FULL || index % 10 === 0 || /eather|errain/.test(textOf(move)));

  test('every candidate move leaves the verdict of its log right', () => {
    let playedMoves = 0;
    let cleanBoth = 0;
    for (const move of candidates) {
      const log = playField(view, {
        p1: { species: SNORLAX, item: rock.name }, moves1: { 1: 'sunnyday', 5: move.id },
        p2: { species: 'Vaporeon', item: extender?.name }, moves2: extender ? { 1: 'electricterrain' } : {},
        turns: 10, slot: 0,
      });
      if (!log) continue;
      playedMoves++;
      const shown = /\|-(?:item|enditem)\|/.test(log);
      const weather = expectVerdict(view, log, { kind: 'weather', condition: 'sunnyday', side: 'p1', species: SNORLAX, held: rock.name }, shown);
      const terrain = extender ? expectVerdict(view, log, { kind: 'terrain', condition: 'electricterrain', side: 'p2', species: 'Vaporeon', held: extender.name }, shown) : true;
      if (weather && terrain) cleanBoth++;
    }
    expect(playedMoves).toBeGreaterThan(0);
    expect(cleanBoth, 'plain moves leave both fields standing to their ends').toBeGreaterThan(0);
  });
});

/**
 * S9, the fields an ability's start leaves standing for good: `startsForGood` runs the condition's `onFieldStart` handler on a
 * stand-in and reads the duration it leaves. Held to the simulator: a log of 12 turns shows the field end exactly when the
 * answer is false. Before Generation 6 an ability's weather lasts for good, while the callback of `conditionTurns` says five and
 * eight for every source: the reader leaves such a start out, so no end that something else causes can read as a lifetime (a
 * setter's faint prints the end after `|upkeep`, which the reader never judges, but the rule needs no such luck).
 */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 3))('S9, the fields an ability leaves standing for good: $name', view => {
  const dex = asRulesDex(view);

  test('startsForGood equals what the log of the simulator shows', () => {
    let compared = 0;
    let forGood = 0;
    for (const { id, condition } of abilitySetters(view)) {
      if (!conditionTurns(dex, condition)) continue;
      const log = played(view, { p1: { species: SNORLAX, ability: view.dex.abilities.get(id).name }, moves2: { 1: 'tackle' }, turns: TURNS });
      const ends = linesOf(view, log).some(line => line.op === 'end');
      expect(startsForGood(dex, condition, id), `${id} sets ${condition}`).toBe(!ends);
      compared++;
      if (!ends) forGood++;
    }
    expect(compared).toBeGreaterThan(0);
    expect(forGood > 0, 'abilities set a weather for good before Generation 6 and not after').toBe(view.dex.gen < 6);
  });
});

/**
 * A log of the simulator never ends a field that stands for good in the residual phase, so the rule is held by a log with a
 * residual end spliced in: the weather of Torkoal's Drought ends where turn 5's upkeep line stood (five turns from the lead). From
 * Generation 6 the five turns rule the rock out; before it the field stands for good and the end proves nothing.
 */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4 && !view.doubles && itemsOf(view, 'sunnyday').length > 0))('a residual end spliced into a field that stands for good: $name', view => {
  test('the spliced end reads as five turns only where an ability\'s weather ends', () => {
    const rock = itemsOf(view, 'sunnyday')[0];
    const log = played(view, { p1: { species: 'Torkoal', ability: 'Drought' }, moves2: {}, turns: 5 });
    let turn = 0;
    const spliced = log.split('\n').map(line => {
      if (line.startsWith('|turn|')) turn = Number(line.split('|')[2]);
      return turn === 5 && line === '|-weather|SunnyDay|[upkeep]' ? '|-weather|none' : line;
    }).join('\n');
    expect(spliced === log, 'from Generation 6 the log has the end already').toBe(view.dex.gen >= 6);
    expect(ruledOut(spliced, 'p1', 'Torkoal', rock.id)).toBe(view.dex.gen >= 6);
  });
});
