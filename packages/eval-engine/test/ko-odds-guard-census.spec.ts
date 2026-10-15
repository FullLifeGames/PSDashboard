import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { toID } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { planCellEvents } from '../src/cell-blend';
import { loadSimMods } from '../src/forward/sim-mods';
import { boundaryEvent, moveAccuracy, unpriceable } from '../src/ko-odds';
import { pairKoOdds } from '../src/pair/odds';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * Round 70 (N1): the one-turn odds model prices a move's accuracy from the stage table and its crit from the move's own
 * ratio, and `unpriceable` sends a pair it cannot price to the plain seed average. Its guard named eleven of the
 * eighteen items and abilities of Gen 9 that carry a handler on a crit or accuracy event (Wide Lens, Zoom Lens, Bright
 * Powder, Lax Incense, Compound Eyes, Hustle, Sand Veil, Snow Cloak, Victory Star, Tangled Feet, Wonder Skin); Leek,
 * Stick, Lucky Punch, Razor Claw, Scope Lens, Merciless and Super Luck passed, and the comment said they "fail closed".
 * The guard now reads the rule from the simulator's Dex: a holder of an item or ability with a handler on the
 * ModifyAccuracy or ModifyCritRatio event (the holder's own, a foe's, an ally's, the source's or any) is unpriceable. This
 * census walks every item and ability of every generation and the Champions mod (@pkmn/dex strips the handlers, so it
 * reads the simulator's Dex), and each effect with a crit or accuracy handler is either guarded or listed below with the
 * reason it stays out; a handler the test has not seen fails it. The guard's answers leave the live battle as it was.
 */

await loadSimMods('gen9championsou');

interface Rules { name: string; gen: number; format: string; level: number; evs?: PokemonSet['evs'] }
const RULES: Rules[] = [
  ...[2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Gen ${gen}`, gen, format: `gen${gen}customgame`, level: 100 })),
  { name: 'Pokémon Champions', gen: 9, format: 'gen9championscustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 } },
];

/** The handlers that change the number the model prices: the accuracy or the crit rate. */
const MODIFIES = /^on(Any|Foe|Ally|Source)?Modify(Accuracy|CritRatio)$/;
/** A handler of the family that leaves both numbers to the model: the event that skips the roll or blocks the crit. */
const PRICED = new Set(['onAnyAccuracy', 'onCriticalHit']);
const FAMILY = /Accuracy|Crit/;
const NOT_A_HANDLER = /(Priority|SubOrder|Order)$/;

/** The effects that carry a family handler and stay unguarded, each with the reason (played below). */
const EXCLUDED: Record<string, string> = {
  'ability:noguard': 'moveAccuracy gives a move of a No Guard side accuracy 1, the number the simulator uses',
  'ability:battlearmor': 'the calc gives a crit-proof defender the normal roll for a crit, so the crit-weighted share is exact at any rate',
  'ability:shellarmor': 'the calc gives a crit-proof defender the normal roll for a crit, so the crit-weighted share is exact at any rate',
  'ability:disguise': 'a cell with the shield on the defender fails before odds are asked (cell-blend.ts defenderShielded)',
  'ability:iceface': 'a cell with the shield on the defender fails before odds are asked (cell-blend.ts defenderShielded)',
};

interface Found { kind: 'item' | 'ability'; id: string; name: string; handlers: string[] }

function effectsOf(battle: Battle, gen: number): Found[] {
  const found: Found[] = [];
  for (const kind of ['item', 'ability'] as const) {
    for (const effect of kind === 'item' ? battle.dex.items.all() : battle.dex.abilities.all()) {
      if (!effect.exists || effect.gen > gen) continue;
      const handlers = Object.keys(effect).filter(key => FAMILY.test(key) && !NOT_A_HANDLER.test(key));
      if (handlers.length) found.push({ kind, id: effect.id, name: effect.name, handlers });
    }
  }
  return found;
}

const keyOf = (found: Found) => `${found.kind}:${found.id}`;
const guardedByRule = (found: Found) => found.handlers.some(handler => MODIFIES.test(handler));

/** Snorlax (attacker) against Blissey (defender), both standing in front. */
function scene(rules: Rules, format = rules.format): Battle {
  const mon = (species: string, moves: string[]): PokemonSet => set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });
  return battleOf(format, [mon('Snorlax', ['hydropump', 'bodyslam', 'tackle'])], [mon('Blissey', ['splash'])]);
}

function place(mon: Pokemon, found: Pick<Found, 'kind' | 'id'>): void {
  if (found.kind === 'item') mon.item = toID(found.id);
  else mon.ability = toID(found.id);
}

const bodies = (battle: Battle) => ({ attacker: battle.sides[0].active[0]!, defender: battle.sides[1].active[0]! });

/** Whether the guard fires with the effect on one seat; the call leaves the battle as it found it. */
function guardFires(battle: Battle, found: Found, seat: 'attacker' | 'defender'): boolean {
  const { attacker, defender } = bodies(battle);
  const holder = bodies(battle)[seat];
  const saved = { item: holder.item, ability: holder.ability };
  place(holder, found);
  const before = fingerprint(battle, [attacker, defender], 'tackle');
  const fires = unpriceable(attacker, defender, battle.dex.moves.get('tackle'));
  expect(fingerprint(battle, [attacker, defender], 'tackle'), `${found.name} as ${seat}`).toBe(before);
  holder.item = saved.item;
  holder.ability = saved.ability;
  return fires;
}

describe.each(RULES)('$name: the items and abilities with a crit or accuracy handler (round 70, N1)', rules => {
  const battle = scene(rules);
  const found = effectsOf(battle, rules.gen);

  test('every handler of the family is on a guarded event or named as priced elsewhere', () => {
    const unknown = found.flatMap(effect => effect.handlers.filter(handler => !MODIFIES.test(handler) && !PRICED.has(handler)).map(handler => `${effect.name} ${handler}`));
    expect(unknown).toEqual([]);
    expect(found.length).toBeGreaterThan(rules.gen < 3 ? 2 : 8);
  });

  test('each effect is guarded on both seats, or listed with its reason', () => {
    const wrong: string[] = [];
    for (const effect of found) {
      const guarded = guardedByRule(effect);
      expect(guarded || keyOf(effect) in EXCLUDED, `${effect.name} is neither guarded nor excluded`).toBe(true);
      for (const seat of ['attacker', 'defender'] as const) {
        if (guardFires(battle, effect, seat) !== guarded) wrong.push(`${effect.name} as ${seat}: the guard ${guarded ? 'misses' : 'trips on'} it`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('the exclusions listed are the effects found with a priced handler only', () => {
    const priced = found.filter(effect => !guardedByRule(effect)).map(keyOf).sort();
    expect(priced.every(key => key in EXCLUDED)).toBe(true);
    expect(priced).toEqual(Object.keys(EXCLUDED).filter(key => found.some(effect => keyOf(effect) === key)).sort());
  });
});

describe('Gen 9: the census in numbers (round 70, N1)', () => {
  test('eighteen effects are guarded, the five listed stay out', () => {
    const battle = scene(RULES[RULES.length - 2]);
    const found = effectsOf(battle, 9);
    expect(found.filter(guardedByRule).map(effect => effect.name).sort()).toEqual([
      'Bright Powder', 'Compound Eyes', 'Hustle', 'Lax Incense', 'Leek', 'Lucky Punch', 'Merciless', 'Razor Claw', 'Sand Veil', 'Scope Lens',
      'Snow Cloak', 'Stick', 'Super Luck', 'Tangled Feet', 'Victory Star', 'Wide Lens', 'Wonder Skin', 'Zoom Lens',
    ]);
    expect(found.filter(effect => !guardedByRule(effect)).map(effect => effect.name).sort()).toEqual(['Battle Armor', 'Disguise', 'Ice Face', 'No Guard', 'Shell Armor']);
  });
});

/** The exclusions above, each played where its effect exists. */
const PLAYED = ['ability:battlearmor', 'ability:disguise', 'ability:iceface', 'ability:noguard', 'ability:shellarmor'];

test('every exclusion has a play below', () => {
  expect(Object.keys(EXCLUDED).sort()).toEqual(PLAYED);
});

describe.each(RULES.filter(rules => rules.gen >= 3))('$name: the exclusions, played (round 70, N1)', rules => {
  const exists = (key: string) => effectsOf(scene(rules), rules.gen).some(effect => keyOf(effect) === key);
  const asHolder = (battle: Battle, id: string, seat: 'attacker' | 'defender') => place(bodies(battle)[seat], { kind: 'ability', id });

  test('No Guard: the model and the simulator both make the move sure, whichever seat holds it', () => {
    if (!exists('ability:noguard')) return;
    for (const seat of ['attacker', 'defender'] as const) {
      const battle = scene(rules);
      const { attacker, defender } = bodies(battle);
      const move = battle.dex.moves.get('hydropump');
      expect(moveAccuracy(battle, move, attacker, defender)).toBeCloseTo(0.8, 5);
      asHolder(battle, 'noguard', seat);
      const before = fingerprint(battle, [attacker, defender], 'hydropump');
      const simulated = battle.runEvent('Accuracy', defender, attacker, battle.dex.getActiveMove('hydropump'), 80);
      expect(simulated).toBe(true);
      expect(moveAccuracy(battle, move, attacker, defender)).toBe(1);
      expect(fingerprint(battle, [attacker, defender], 'hydropump')).toBe(before);
    }
  });

  test.each(['battlearmor', 'shellarmor'])('%s: a crit of the calc equals its normal roll, so no crit rate is needed', id => {
    if (!exists(`ability:${id}`)) return;
    const battle = scene(rules);
    const { attacker, defender } = bodies(battle);
    const reads = (hp: number) => {
      (defender as { hp: number }).hp = hp;
      return boundaryEvent(battle, attacker, defender, 'bodyslam');
    };
    // Where a crit kills and a normal hit does not, a defender that blocks the crit loses the difference.
    let hp = defender.maxhp;
    while (hp > 8 && !((reads(hp)?.critKillRolls ?? 0) > (reads(hp)?.normalKillRolls ?? 0))) hp -= 8;
    expect(hp, 'a straddling HP exists').toBeGreaterThan(8);
    const plain = reads(hp)!;
    expect(plain.critKillRolls).toBeGreaterThan(plain.normalKillRolls);
    asHolder(battle, id, 'defender');
    const blocked = reads(hp)!;
    expect(blocked.critKillRolls).toBe(blocked.normalKillRolls);
    expect(blocked.normalKillRolls).toBe(plain.normalKillRolls);
  });

  test.each(['disguise', 'iceface'])('%s: the cell is failed, no odds are asked', id => {
    if (!exists(`ability:${id}`)) return;
    const battle = scene(rules);
    expect(planCellEvents(battle, 'move hydropump', 'move splash').kind).toBe('events');
    asHolder(battle, id, 'defender');
    expect(planCellEvents(battle, 'move hydropump', 'move splash')).toEqual({ kind: 'fail' });
  });
});

describe('Gen 9: a newly guarded effect behaves like Wide Lens in every consumer (round 70, N1)', () => {
  const rules = RULES[RULES.length - 2];
  const newly = ['item:leek', 'item:stick', 'item:luckypunch', 'item:razorclaw', 'item:scopelens', 'ability:merciless', 'ability:superluck'];
  const effects = (keys: string[]) => keys.map((key): Found => ({ kind: key.startsWith('item') ? 'item' : 'ability', id: key.split(':')[1], name: key, handlers: [] }));

  test.each(effects([...newly, 'item:widelens']))('$name: no boundary event, the same cell plan, whichever seat holds it', found => {
    const plans: unknown[] = [];
    for (const seat of ['attacker', 'defender'] as const) {
      const battle = scene(rules);
      const { attacker, defender } = bodies(battle);
      place(bodies(battle)[seat], found);
      expect(boundaryEvent(battle, attacker, defender, 'hydropump')).toBeNull();
      expect(boundaryEvent(battle, attacker, defender, 'bodyslam')).toBeNull();
      plans.push(planCellEvents(battle, 'move hydropump', 'move splash'));
    }
    expect(plans).toEqual([{ kind: 'fail' }, { kind: 'fail' }]);
  });

  test.each(effects(newly))('$name: the doubles odds of an option read no event either', found => {
    const doubles = () => {
      const mon = (species: string, moves: string[]): PokemonSet => set(species, moves, {});
      return battleOf('gen9doublescustomgame', [mon('Snorlax', ['hydropump', 'splash']), mon('Blissey', ['splash'])], [mon('Pikachu', ['splash']), mon('Chansey', ['splash'])]);
    };
    const option = 'move hydropump 1, move splash';
    // The foe's HP where Hydro Pump's kill is a roll: its odds are an event for a body without the effect.
    const plain = doubles();
    const foe = plain.sides[1].active[0]!;
    let hp = foe.maxhp;
    while (hp > 1 && pairKoOdds(plain, 'p1', [option])[0] === null) {
      hp -= 5;
      (foe as { hp: number }).hp = hp;
    }
    expect(pairKoOdds(plain, 'p1', [option])[0], 'the plain body reads an event at some HP').not.toBeNull();
    for (const seat of ['attacker', 'defender'] as const) {
      const guarded = doubles();
      (guarded.sides[1].active[0] as { hp: number }).hp = hp;
      place(seat === 'attacker' ? guarded.sides[0].active[0]! : guarded.sides[1].active[0]!, found);
      expect(pairKoOdds(guarded, 'p1', [option])).toEqual([null]);
    }
  });
});
