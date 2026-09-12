import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { classChildren, groupedChildren, speedTie } from '../src/search/outcome-children';
import { SEARCH_SEEDS } from '../src/search/leaf';

/**
 * Round 43: outcome children on demand. The boundary event's kill-roll
 * counts, the class path with forced draws, the empirical grouping, and
 * the speed-tie split.
 */

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(formatid: string, p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** Sets the first active's HP per side (null keeps full HP) and serializes. */
function serializeAt(battle: Battle, hp: [number | null, number | null]): string {
  hp.forEach((value, index) => { if (value !== null) battle.sides[index].active[0]!.sethp(value); });
  return JSON.stringify(State.serializeBattle(battle));
}

const jolt = () => makeSet('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt']);
const champ = () => makeSet('Champ', 'Machamp', ['Close Combat']);

describe('boundary event kill rolls (round 43)', () => {
  test('a sure kill counts 16 rolls, a status roll none, a range its share', () => {
    const sure = createRootPosition(serializeAt(makeBattle('gen9customgame', [jolt()], [champ()]), [null, 1]));
    const battle = positionBattle(sure);
    const thunder = boundaryEvent(battle, battle.sides[0].active[0]!, battle.sides[1].active[0]!, 'thunder')!;
    expect(thunder.normalKillRolls).toBe(16);
    expect(thunder.critKillRolls).toBe(16);
    expect(thunder.killFraction).toBe(1);

    const full = createRootPosition(serializeAt(makeBattle('gen9customgame', [jolt()], [champ()]), [null, null]));
    const fullBattle = positionBattle(full);
    const bolt = boundaryEvent(fullBattle, fullBattle.sides[0].active[0]!, fullBattle.sides[1].active[0]!, 'thunderbolt')!;
    expect(bolt.normalKillRolls).toBe(0);
    expect(bolt.critKillRolls).toBeGreaterThanOrEqual(0);
    expect(bolt.killFraction).toBeCloseTo((bolt.normalKillRolls * 23 / 24 + bolt.critKillRolls / 24) / 16, 9);

    // Machamp in range of a non-crit Thunderbolt: some rolls kill, some do not.
    const range = createRootPosition(serializeAt(makeBattle('gen9customgame', [jolt()], [champ()]), [null, 160]));
    const rangeBattle = positionBattle(range);
    const inRange = boundaryEvent(rangeBattle, rangeBattle.sides[0].active[0]!, rangeBattle.sides[1].active[0]!, 'thunderbolt')!;
    expect(inRange.normalKillRolls).toBeGreaterThan(0);
    expect(inRange.normalKillRolls).toBeLessThan(16);
    expect(inRange.critKillRolls).toBe(16);
  });
});

// Both at 1 HP (the solver test's shape): Thunder kills on a hit, Close Combat kills for sure after a miss, so Thunder is the only priced event.
const thunderAtOne = () => createRootPosition(serializeAt(makeBattle('gen9customgame', [jolt()], [champ()]), [1, 1]));
const TREE_OPTS = { baseSeeds: [SEARCH_SEEDS[0]], forcedCap: 6 };
const weights = (children: { key: string; weight: number }[]) => Object.fromEntries(children.map(child => [child.key, Number(child.weight.toFixed(6))]));

describe('classChildren (round 43)', () => {
  test('thunder 70: one natural draw plus one forced draw give miss and hit-kill without probe seeds', () => {
    const drawn = classChildren(thunderAtOne(), 'move thunder', 'move closecombat', TREE_OPTS)!;
    expect(drawn).not.toBeNull();
    expect(drawn.tie).toBe(false);
    expect(drawn.missing).toEqual([]);
    expect(weights(drawn.children)).toEqual({ 'p1:miss': 0.3, 'p1:hit-kill': 0.7 });
    const kill = drawn.children.find(child => child.key === 'p1:hit-kill')!;
    expect(positionBattle(kill.position).sides[1].pokemon[0].fainted).toBe(true);
    const miss = drawn.children.find(child => child.key === 'p1:miss')!;
    expect(positionBattle(miss.position).sides[1].pokemon[0].fainted).toBe(false);
    // Deterministic.
    const again = classChildren(thunderAtOne(), 'move thunder', 'move closecombat', TREE_OPTS)!;
    expect(again.children.map(child => child.position.serialized)).toEqual(drawn.children.map(child => child.position.serialized));
  });

  test('the knock-out class stops at the switch request when asked', () => {
    const root = createRootPosition(serializeAt(makeBattle('gen9customgame',
      [jolt(), makeSet('Lax', 'Snorlax', ['Body Slam'])], [champ(), makeSet('Egg', 'Chansey', ['Soft-Boiled'])]), [1, 1]));
    const drawn = classChildren(root, 'move thunder', 'move closecombat', { ...TREE_OPTS, stopAtForcedSwitch: true })!;
    const kill = drawn.children.find(child => child.key === 'p1:hit-kill')!;
    expect(kill.pendingSwitch).toBe(true);
    // The miss lets Close Combat take Jolteon: p1's switch request opens instead.
    expect(drawn.children.find(child => child.key === 'p1:miss')!.pendingSwitch).toBe(true);
    expect(positionBattle(drawn.children.find(child => child.key === 'p1:miss')!.position).sides[0].pokemon[0].fainted).toBe(true);
  });

  test('a knock-out only a crit reaches gets a crit representative', () => {
    // Thunderbolt against a Machamp whose HP sits above every non-crit roll but under the crit rolls:
    // the first HP from the top of the non-crit range where no normal roll kills and a crit roll still does.
    // Jolteon at 1 HP keeps Close Combat a sure kill (no second event).
    const eventAt = (hp: number) => {
      const root = createRootPosition(serializeAt(makeBattle('gen9customgame', [jolt()], [champ()]), [1, hp]));
      const battle = positionBattle(root);
      return { root, event: boundaryEvent(battle, battle.sides[0].active[0]!, battle.sides[1].active[0]!, 'thunderbolt')! };
    };
    let hp = 150;
    while (hp < 300 && eventAt(hp).event.normalKillRolls > 0) hp += 1;
    const { root, event } = eventAt(hp);
    expect(event.normalKillRolls).toBe(0);
    expect(event.critKillRolls).toBeGreaterThan(0);
    const drawn = classChildren(root, 'move thunderbolt', 'move closecombat', TREE_OPTS)!;
    expect(drawn.missing).toEqual([]);
    const kill = drawn.children.find(child => child.key === 'p1:hit-kill')!;
    expect(kill).toBeDefined();
    expect(positionBattle(kill.position).sides[1].pokemon[0].fainted).toBe(true);
    expect(drawn.children.find(child => child.key === 'p1:hit-nokill')).toBeDefined();
  });

  test('a singles speed tie splits into both orders with forced first movers', () => {
    const a = makeSet('Alpha', 'Machamp', ['Close Combat']);
    const b = makeSet('Beta', 'Machamp', ['Close Combat']);
    const root = createRootPosition(serializeAt(makeBattle('gen9customgame', [a], [b]), [1, 1]));
    expect(speedTie(positionBattle(root), 'move closecombat', 'move closecombat')).toBe(true);
    const drawn = classChildren(root, 'move closecombat', 'move closecombat', TREE_OPTS)!;
    expect(drawn.tie).toBe(true);
    expect(drawn.missing).toEqual([]);
    expect(weights(drawn.children)).toEqual({ 'p1:none': 0.5, 'p2:none': 0.5 });
    const p1First = drawn.children.find(child => child.key === 'p1:none')!;
    expect(positionBattle(p1First.position).sides[1].pokemon[0].fainted).toBe(true);
    const p2First = drawn.children.find(child => child.key === 'p2:none')!;
    expect(positionBattle(p2First.position).sides[0].pokemon[0].fainted).toBe(true);
  });

  test('no plan and no tie: null (the caller draws one child)', () => {
    const root = createRootPosition(serializeAt(makeBattle('gen9customgame',
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])], [makeSet('Egg', 'Chansey', ['Soft-Boiled'])]), [null, null]));
    expect(classChildren(root, 'move seismictoss', 'move softboiled', TREE_OPTS)).toBeNull();
    // Doubles pairs have no class plan either.
    const doubles = createRootPosition(serializeAt(makeBattle('gen9doublescustomgame',
      [jolt(), champ()], [champ(), makeSet('Chu', 'Pikachu', ['Tackle'], 30)]), [null, null]));
    expect(classChildren(doubles, 'move thunder 1, move closecombat 1', 'move closecombat 1, move tackle 1', TREE_OPTS)).toBeNull();
  });
});

describe('groupedChildren (round 43)', () => {
  const DOUBLES_OPTS = { seeds: SEARCH_SEEDS.slice(0, 3) };

  test('a pair without a knock-out or a roll draws one seed and one child', () => {
    const root = createRootPosition(serializeAt(makeBattle('gen9doublescustomgame',
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Lax', 'Snorlax', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Bliss', 'Blissey', ['Soft-Boiled'])]), [null, null]));
    const drawn = groupedChildren(root, 'move seismictoss 1, move seismictoss 2', 'move softboiled, move softboiled', DOUBLES_OPTS);
    expect(drawn.children).toHaveLength(1);
    expect(drawn.children[0].weight).toBe(1);
    expect(drawn.children[0].key).toBe('');
    expect(drawn.events).toEqual([]);
  });

  test('a knock-out range in doubles groups three seeds by who fell', () => {
    // Thunder (70 %) on a one-HP Machamp: the three seeds split into "Champ fell" and "nobody fell".
    const root = createRootPosition(serializeAt(makeBattle('gen9doublescustomgame',
      [jolt(), makeSet('Lax', 'Snorlax', ['Protect'])],
      [champ(), makeSet('Egg', 'Chansey', ['Soft-Boiled'])]), [null, 1]));
    const drawn = groupedChildren(root, 'move thunder 1, move protect', 'move closecombat 1, move softboiled', DOUBLES_OPTS);
    const totalWeight = drawn.children.reduce((sum, child) => sum + child.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 9);
    expect(drawn.children.every(child => Number.isInteger(Math.round(child.weight * 3 * 1e6) / 1e6))).toBe(true);
    for (const child of drawn.children) {
      const fell = positionBattle(child.position).sides[1].pokemon[0].fainted;
      expect(child.key.includes('p2a: Champ')).toBe(fell);
    }
    const again = groupedChildren(root, 'move thunder 1, move protect', 'move closecombat 1, move softboiled', DOUBLES_OPTS);
    expect(again.children.map(child => child.key)).toEqual(drawn.children.map(child => child.key));
  });

  test('singles guard cells (Substitute) take the empirical path too', () => {
    const root = createRootPosition(serializeAt(makeBattle('gen9customgame',
      [jolt()], [makeSet('Lax', 'Snorlax', ['Substitute', 'Body Slam'])]), [null, 1]));
    const drawn = groupedChildren(root, 'move thunder', 'move substitute', { seeds: SEARCH_SEEDS.slice(0, 3), stopAtForcedSwitch: true });
    expect(drawn.children.length).toBeGreaterThanOrEqual(1);
    expect(drawn.children.reduce((sum, child) => sum + child.weight, 0)).toBeCloseTo(1, 9);
  });
});
