import { describe, expect, test } from 'vitest';
import { conditionTurns, startsForGood } from '../src/dex-facts/screen-turns';
import type { RulesDex } from '../src/rules-dex';
import { RULE_VIEWS, proven, ruledOut, type Holder, type Side } from './screen-scenes';
import { cleanEnd, fieldLines, playField, type FieldLine, type FieldSceneOptions } from './field-scenes';
import type { SimView } from './sim-views';

// Oracle `cleanEnd`: a log that ends cleanly gives exactly the held item's verdict, every other log gives none.
// A plain run plays every tenth move and the weather and terrain moves; `DICE_SWEEPS=full` plays every move.

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

function fieldMoves(view: SimView): { move: string; condition: string; kind: FieldLine['kind'] }[] {
  return view.dex.moves.all().filter(move => legal(view, move) && (move.weather || move.terrain)).map(move => {
    const condition = view.dex.conditions.get((move.weather ?? move.terrain)!).id;
    return { move: move.id, condition, kind: move.terrain ? 'terrain' as const : 'weather' as const };
  });
}

const known = (view: SimView, ids: string[]): string[] => ids.filter(id => legal(view, view.dex.moves.get(id)));

function itemsOf(view: SimView, condition: string): { id: string; name: string }[] {
  const table = conditionTurns(asRulesDex(view), condition);
  return [...(table?.byItem.keys() ?? [])].map(id => ({ id, name: view.dex.items.get(id).name }));
}

function expectVerdict(view: SimView, log: string, scene: { kind: FieldLine['kind']; condition: string; side: Side; species: string; held?: string }, sound = false): boolean {
  const items = itemsOf(view, scene.condition);
  const clean = cleanEnd(linesOf(view, log), scene.kind, scene.side, scene.side) !== null;
  const ruled = items.filter(item => ruledOut(log, scene.side, scene.species, item.id)).map(item => item.id).sort();
  const shown = proven(log, scene.side, scene.species);
  const label = `${scene.condition} held ${scene.held ?? 'nothing'}`;
  const held = items.find(item => item.name === scene.held);
  if (sound && clean) {
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

const NAMED_ABILITIES: [string, number][] = [['drought', 3], ['drizzle', 3], ['sandstream', 3], ['snowwarning', 4], ['electricsurge', 7], ['grassysurge', 7], ['mistysurge', 7], ['psychicsurge', 7], ['sandspit', 8], ['seedsower', 9]];

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 3))('the setter of a move: $name', view => {
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

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 3))('the setter of an ability: $name', view => {
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
          // Before Gen 6 an ability's weather lasts for good, as does a primal one: no move sets it, so no Dex turns.
          const finite = view.dex.gen >= 6 && fieldMoves(view).some(entry => entry.condition === condition);
          expect(clean, finite ? 'the log shows the field ending cleanly' : 'the field stands for good').toBe(finite);
        });
      }
    }
  }
});

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4))('the turns prove nothing: $name', view => {
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
      expect(proven(log, 'p1', SNORLAX), `${first} then ${second}`).toBe('');
    }
  });
});

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4 && itemsOf(view, 'sunnyday').length > 0))('removers and movers of weather and terrain: $name', view => {
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

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 3))('the fields an ability leaves standing for good: $name', view => {
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

// The simulator never ends a field that stands for good in the residual phase: a spliced residual end holds the rule.
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
