import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { conditionTurns, ITEM_BLOCKERS } from '../src/dex-facts/screen-turns';
import type { RulesDex } from '../src/rules-dex';
import { RULE_VIEWS as VIEWS } from './screen-scenes';
import { battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 86 (T310, Light Clay from the screen turns): the Dex reader `conditionTurns` is held to the simulator. The log shows a
 * screen's start and end but never the item, so the reader asks each condition's own `durationCallback` for the turns of a
 * source with no item and of a source holding each item. Two sweeps, in every rule set the corpus plays (Generations 1 to 9
 * and the Champions mod, singles; Generations 3 to 9 and the Champions mod, doubles):
 *  - S1, the turns: for every condition a move of the rule set sets (a side condition, a pseudo weather, a weather or a
 *    terrain) and every item of the rule set, the reader's turns equal what a real Pokémon holding the item gets from the
 *    condition's rule on a real battle. A condition with no callback gives null.
 *  - S2, the ignoring holders: a Light Clay holder's screen lasts its plain turns when, and only when, an ability, a volatile or
 *    a field condition of the rule set makes the simulator ignore the item. Every ability, move and condition of the rule set
 *    is played; the causes found equal `ITEM_BLOCKERS` (the list the screen reader doubts), so a Dex entry that adds a fourth
 *    cause fails here.
 * The reader takes no battle (a stand-in source, the Dex only), so a guard checks that it leaves a live battle untouched.
 */

const SPEC = 'packages/replay-core/test/screen-turns-sweep.spec.ts';

const asRulesDex = (view: SimView): RulesDex => view.dex as unknown as RulesDex;

type DexMove = ReturnType<RulesDex['moves']['get']>;
type Callback = (this: unknown, ...args: unknown[]) => unknown;

/** The moves of a rule set that set a condition: [condition id, side or field, the move]. */
function conditionSetters(view: SimView): { id: string; side: boolean; move: DexMove }[] {
  const dex = asRulesDex(view);
  const found = new Map<string, { id: string; side: boolean; move: DexMove }>();
  for (const move of dex.moves.all()) {
    if (!move.exists || move.gen > dex.gen) continue;
    const side = move.sideCondition ?? move.self?.sideCondition;
    const field = move.pseudoWeather ?? move.weather ?? move.terrain;
    const entry = side ? { id: dex.conditions.get(side).id, side: true, move } : field ? { id: dex.conditions.get(field).id, side: false, move } : null;
    if (entry && !found.has(entry.id)) found.set(entry.id, entry);
  }
  return [...found.values()];
}

/** The board: Snorlax (side p1) beside a Blissey in doubles, a Vaporeon (side p2) beside a second one. */
function board(view: SimView): { battle: Battle; setter: Pokemon; target: Pokemon } {
  const p1 = [mon('Snorlax', ['splash']), ...(view.doubles ? [mon('Blissey', ['splash'])] : [])];
  const p2 = [mon('Vaporeon', ['splash']), ...(view.doubles ? [mon('Vaporeon', ['splash'])] : [])];
  const battle = battleIn(view, p1, p2);
  return { battle, setter: battle.sides[0].active[0]!, target: battle.sides[1].active[0]! };
}

const hold = (battle: Battle, setter: Pokemon, item: string): void => {
  setter.item = item;
  setter.itemState = battle.initEffectState({ id: item, target: setter });
};

describe('the oracle tag', () => {
  test('the blockers list names this spec', () => {
    expect(oracleTagAbove('packages/replay-core/src/dex-facts/screen-turns.ts', 'export const ITEM_BLOCKERS', SPEC)).toBe(true);
  });
});

describe.each(VIEWS)('S1, the turns of a condition: $name', view => {
  const dex = asRulesDex(view);
  const setters = conditionSetters(view);
  const asked = (id: string) => (dex.conditions.get(id) as unknown as { durationCallback?: Callback }).durationCallback;

  test('a condition with no durationCallback gives null', () => {
    const none = setters.filter(entry => typeof asked(entry.id) !== 'function');
    for (const entry of none) expect(conditionTurns(dex, entry.id), entry.id).toBeNull();
    // Generation 1 builds its screens as volatiles and has no side condition or field move
    if (dex.gen >= 2) expect(setters.length).toBeGreaterThan(0);
  });

  test('every condition with a callback gives the turns a real holder of each item gets', () => {
    const withCallback = setters.filter(entry => typeof asked(entry.id) === 'function');
    if (withCallback.length === 0) return;
    const { battle, setter, target } = board(view);
    const items = dex.items.all().filter(item => item.exists && item.gen <= dex.gen);
    let changed = 0;
    for (const entry of withCallback) {
      const callback = asked(entry.id)!;
      const real = (): unknown => (entry.side ? callback.call(battle, target, setter, entry.move) : callback.call(battle, setter, entry.move));
      const turns = conditionTurns(dex, entry.id);
      expect(turns, entry.id).not.toBeNull();
      hold(battle, setter, '');
      const plain = real();
      expect(turns!.plain, `${entry.id} plain`).toBe(plain);
      for (const item of items) {
        hold(battle, setter, item.id);
        expect(turns!.byItem.get(item.id) ?? plain, `${entry.id} held ${item.id}`).toBe(real());
        if (turns!.byItem.has(item.id)) changed++;
      }
      hold(battle, setter, '');
      // an item the table names changes the turns, and one it lacks leaves them alone
      for (const [item, count] of turns!.byItem) expect(count, `${entry.id} ${item}`).not.toBe(turns!.plain);
    }
    if (dex.gen >= 4) expect(changed).toBeGreaterThan(0);
  });

  test('the screens: Light Clay from Generation 4, nothing before', () => {
    for (const id of ['reflect', 'lightscreen', 'auroraveil']) {
      const turns = conditionTurns(dex, id);
      const exists = dex.moves.all().some(move => move.exists && move.gen <= dex.gen && (move.sideCondition === id));
      if (!exists || dex.gen <= 2) {
        expect(turns, id).toBeNull();
        continue;
      }
      expect(turns!.plain, id).toBe(5);
      expect([...turns!.byItem], id).toEqual(dex.gen >= 4 ? [['lightclay', 8]] : []);
    }
  });

  test('the reader leaves a live battle untouched', () => {
    const { battle, setter } = board(view);
    const state = () => JSON.stringify({ log: battle.log.length, seed: battle.prng.getSeed(), item: setter.item, volatiles: Object.keys(setter.volatiles), conditions: Object.keys(battle.field.pseudoWeather) });
    const before = state();
    for (const entry of setters) conditionTurns(battle.dex as unknown as RulesDex, entry.id);
    expect(state()).toBe(before);
  });
});

describe.each(VIEWS.filter(view => view.dex.gen >= 4))('S2, the holders that ignore the item: $name', view => {
  const dex = asRulesDex(view);

  /** The causes found: every ability, and every condition as a volatile of the holder and as a field condition. */
  function causes(): string[] {
    const { battle, setter, target } = board(view);
    const move = dex.moves.all().find(entry => entry.exists && entry.gen <= dex.gen && entry.sideCondition === 'reflect')!;
    const callback = (dex.conditions.get('reflect') as unknown as { durationCallback: Callback }).durationCallback;
    const ask = (): unknown => callback.call(battle, target, setter, move);
    hold(battle, setter, 'lightclay');
    expect(ask(), 'a Light Clay holder with nothing in the way').toBe(8);
    const found: string[] = [];
    const ability = setter.ability;
    for (const entry of dex.abilities.all().filter(candidate => candidate.exists && candidate.gen <= dex.gen)) {
      setter.ability = entry.id;
      setter.abilityState = battle.initEffectState({ id: entry.id, target: setter });
      if (ask() !== 8) found.push(`ability:${entry.id}`);
    }
    setter.ability = ability;
    const ids = new Set<string>(Object.keys(dex.data.Conditions));
    for (const entry of dex.moves.all()) if (entry.exists && entry.gen <= dex.gen) ids.add(entry.id);
    for (const id of ids) {
      setter.volatiles[id] = battle.initEffectState({ id, target: setter });
      if (ask() !== 8) found.push(`volatile:${id}`);
      delete setter.volatiles[id];
      battle.field.pseudoWeather[id] = battle.initEffectState({ id, target: setter });
      if (ask() !== 8) found.push(`field:${id}`);
      delete battle.field.pseudoWeather[id];
    }
    return found.sort();
  }

  test('the causes found are the blockers the rule set has', () => {
    const has = (kind: 'moves' | 'abilities', id: string) => dex[kind].get(id).exists && dex[kind].get(id).gen <= dex.gen;
    const expected = [
      ...ITEM_BLOCKERS.ability.filter(id => has('abilities', id)).map(id => `ability:${id}`),
      ...ITEM_BLOCKERS.volatile.filter(id => has('moves', id)).map(id => `volatile:${id}`),
      ...ITEM_BLOCKERS.field.filter(id => has('moves', id)).map(id => `field:${id}`),
    ].sort();
    expect(causes()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});
