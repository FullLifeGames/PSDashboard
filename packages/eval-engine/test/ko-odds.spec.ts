import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { boundaryEvent, critRate } from '../src/ko-odds';
import { koOddsForOptions, planCellEvents } from '../src/cell-blend';
import { createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { parsePairChoice } from '../src/pair/guards';
import { rollSet as set, rootOf, checkedRolls, drawTurn } from './calc-roll-oracle';
import { createBranchStateFromBattle } from '../src/branch/state';
import { calcSingleDamageRange } from '../src/damage-calc';
import { pairKoOdds } from '../src/pair/odds';
import { killing, simDamages } from './sim-rolls';

function makeSet(name: string, species: string, moves: string[], level = 50, item = '', ability = 'No Ability'): PokemonSet {
  return {
    name, species, item, ability, moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const actives = (battle: Battle) => ({ atk: battle.sides[0].active[0]!, def: battle.sides[1].active[0]! });

describe('boundaryEvent arithmetic', () => {
  test('a guaranteed fixed-damage KO prices accuracy 1, killFraction 1', () => {
    // Level-100 Seismic Toss = flat 100 into a level-30 Pikachu (< 100 max HP).
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
    );
    const { atk, def } = actives(battle);
    const event = boundaryEvent(battle, atk, def, 'seismictoss');
    expect(event).not.toBeNull();
    expect(event!.accuracy).toBe(1);
    expect(event!.killFraction).toBe(1);
    expect(event!.pKill).toBe(1);
  });

  test('an 80%-accurate move carries accuracy 0.8', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
    );
    const { atk, def } = actives(battle);
    const event = boundaryEvent(battle, atk, def, 'hydropump');
    expect(event).not.toBeNull();
    expect(event!.accuracy).toBeCloseTo(0.8, 5);
    expect(event!.killFraction).toBe(1);
    expect(event!.pKill).toBeCloseTo(0.8, 5);
  });

  test('full-HP same-tier Body Slam has killFraction 0', () => {
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Body Slam'], 50)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    const { atk, def } = actives(battle);
    expect(boundaryEvent(battle, atk, def, 'bodyslam')!.killFraction).toBe(0);
  });

  test('crit weighting lifts killFraction strictly between non-crit and crit fractions', () => {
    // Walk the defender's HP down until the damage range (crit-weighted)
    // straddles it: killFraction must sit strictly inside (0, 1) there.
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Body Slam'], 50)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    const { atk, def } = actives(battle);
    for (let hp = def.maxhp; hp > 0; hp -= 5) {
      (def as { hp: number }).hp = hp;
      const event = boundaryEvent(battle, atk, def, 'bodyslam');
      if (event && event.killFraction > 0 && event.killFraction < 1) {
        expect(event.killFraction).toBeGreaterThan(0);
        expect(event.killFraction).toBeLessThan(1);
        return;
      }
    }
    throw new Error('no straddling HP found — fixture needs retuning');
  });

  test('evasion stages shift accuracy by the stage table', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Double Team'], 30)],
    );
    const { atk, def } = actives(battle);
    def.boosts.evasion = 1;
    const event = boundaryEvent(battle, atk, def, 'hydropump')!;
    expect(event.accuracy).toBeCloseTo(0.8 * 3 / 4, 5);
  });

  test('a status move with imperfect accuracy yields an accuracy-only event', () => {
    const battle = makeBattle(
      [makeSet('Muk', 'Muk', ['Toxic'], 50)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    const { atk, def } = actives(battle);
    const event = boundaryEvent(battle, atk, def, 'toxic')!;
    expect(event.accuracy).toBeCloseTo(0.9, 5);
    expect(event.killFraction).toBe(0);
    expect(event.pKill).toBe(0);
  });

  test('a status move that cannot miss has no event', () => {
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Swords Dance'], 50)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    const { atk, def } = actives(battle);
    expect(boundaryEvent(battle, atk, def, 'swordsdance')).toBeNull();
  });

  test('fail-closed: multi-hit, charge, counter family, self-KO, random-call, Sucker Punch', () => {
    const battle = makeBattle(
      [makeSet('Cloyster', 'Cloyster', ['Icicle Spear', 'Solar Beam', 'Counter', 'Explosion'], 50)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    const { atk, def } = actives(battle);
    for (const id of ['iciclespear', 'solarbeam', 'counter', 'explosion', 'sleeptalk', 'suckerpunch']) {
      expect(boundaryEvent(battle, atk, def, id)).toBeNull();
    }
  });

  test('fail-closed: accuracy-modifying item on the attacker', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100, 'Wide Lens')],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
    );
    const { atk, def } = actives(battle);
    expect(boundaryEvent(battle, atk, def, 'hydropump')).toBeNull();
  });

  test('fail-closed: gen 2 and below', () => {
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Body Slam'], 50)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
      'gen2customgame',
    );
    const { atk, def } = actives(battle);
    expect(boundaryEvent(battle, atk, def, 'bodyslam')).toBeNull();
  });

  test('weather rule: Blizzard in hail cannot miss', () => {
    const battle = makeBattle(
      [makeSet('Abomasnow', 'Abomasnow', ['Blizzard'], 50, '', 'Snow Warning')],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
      'gen6customgame',
    );
    const { atk, def } = actives(battle);
    const event = boundaryEvent(battle, atk, def, 'blizzard');
    expect(event).not.toBeNull();
    expect(event!.accuracy).toBe(1);
  });
});

function clicked(root: SimPosition, side: 0 | 1, slot: number): Battle {
  const twin = positionBattle(createRootPosition(root.serialized));
  twin.actions.terastallize(twin.sides[side].active[slot]!);
  return twin;
}

/** The first defender HP (in steps) where the twin the simulator clicked shows real odds for the option: a kill, not a sure one. */
function rootWithOdds(make: (hp: number) => SimPosition, choice: string): SimPosition {
  for (let hp = 10; hp <= 400; hp += 5) {
    const root = make(hp);
    if (koOddsForOptions(clicked(root, 0, 0), 'p1', [choice])[0]) return root;
  }
  throw new Error('no HP gives the clicked option real odds');
}

const singles = (hp: number) => rootOf('gen9customgame',
  [set('Garchomp', ['Tera Blast', 'Earthquake'], { teraType: 'Fire' })],
  [set('Snorlax', ['Splash'], { ability: 'Battle Armor', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['Splash'])],
  battle => { battle.sides[1].active[0].sethp(hp); });

const ogerpon = (): PokemonSet => set('Ogerpon-Hearthflame', ['Ivy Cudgel', 'Protect'], { ability: 'Mold Breaker', item: 'Hearthflame Mask', teraType: 'Fire' });

describe('Tera options price their odds on the Tera body', () => {
  test('singles: the Tera Blast Tera option reads the Fire body, as the simulator\'s click makes it', () => {
    const choice = 'move terablast terastallize';
    const root = rootWithOdds(singles, choice);
    const [odds] = koOddsForOptions(positionBattle(root), 'p1', [choice]);
    expect(odds).not.toBeNull();
    // The odds are the click's either way; the attacker's species is the one the battle shows (the -Tera forme after the click).
    expect({ ...odds, attacker: undefined }).toEqual({ ...koOddsForOptions(clicked(root, 0, 0), 'p1', [choice])[0], attacker: undefined });
  });

  test('singles: a root cell with a Tera choice plans its event on the Tera body', () => {
    const root = rootWithOdds(singles, 'move terablast terastallize');
    const plan = planCellEvents(positionBattle(root), 'move terablast terastallize', 'move splash');
    expect(plan.kind).toBe('events');
    expect(plan).toEqual(planCellEvents(clicked(root, 0, 0), 'move terablast terastallize', 'move splash'));
  });

  test('singles: a cell where the defender\'s side clicks Tera prices the hit on the defender\'s Tera body, as the turn lands it', () => {
    const at = (hp: number) => rootOf('gen9customgame',
      [set('Garchomp', ['Earthquake'])],
      [set('Snorlax', ['Splash'], { ability: 'Battle Armor', teraType: 'Flying', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } })],
      battle => { battle.sides[1].active[0].sethp(hp); });
    let root = at(1);
    for (let hp = 10; hp <= 260 && planCellEvents(positionBattle(root), 'move earthquake', 'move splash').kind !== 'events'; hp += 5) root = at(hp);
    expect(planCellEvents(positionBattle(root), 'move earthquake', 'move splash').kind).toBe('events');
    const twin = positionBattle(createRootPosition(root.serialized));
    twin.actions.terastallize(twin.sides[1].active[0]!);
    const plan = planCellEvents(positionBattle(root), 'move earthquake', 'move splash terastallize');
    expect(plan).toEqual(planCellEvents(twin, 'move earthquake', 'move splash terastallize'));
    expect(plan).not.toEqual(planCellEvents(positionBattle(root), 'move earthquake', 'move splash'));
  });

  test('singles: without the flag the odds read the body as it stands (the prover and the near-decided stage)', () => {
    const battle = positionBattle(rootWithOdds(singles, 'move terablast terastallize'));
    const [garchomp, snorlax] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const plain = boundaryEvent(battle, garchomp, snorlax, 'terablast');
    expect(plain).toEqual(boundaryEvent(battle, garchomp, snorlax, 'terablast', { attacker: false }));
    expect(plain).not.toEqual(boundaryEvent(battle, garchomp, snorlax, 'terablast', { attacker: true }));
  });

  test('doubles: Ogerpon-Hearthflame\'s Tera Ivy Cudgel reads its -Tera forme and Embody Aspect stage, as the simulator\'s click makes them', () => {
    const choice = 'move ivycudgel 1 terastallize, move roost';
    const root = rootWithOdds(hp => rootOf('gen9doublescustomgame',
      [ogerpon(), set('Corviknight', ['Roost', 'Protect'])],
      [set('Snorlax', ['Splash'], { ability: 'Battle Armor', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['Soft-Boiled'])],
      battle => { battle.sides[1].active[0].sethp(hp); }), choice);
    const battle = positionBattle(root);
    const [odds] = koOddsForOptions(battle, 'p1', [choice]);
    expect(odds).not.toBeNull();
    expect({ ...odds, attacker: undefined }).toEqual({ ...koOddsForOptions(clicked(root, 0, 0), 'p1', [choice])[0], attacker: undefined });
    expect(parsePairChoice(battle, 0, choice)).toEqual([
      { kind: 'move', slot: 0, moveId: 'ivycudgel', loc: 1, tera: true },
      { kind: 'move', slot: 1, moveId: 'roost', loc: null },
    ]);
  });
});

const terapagos = (): PokemonSet => set('Terapagos', ['Tera Starstorm', 'Splash'], { ability: 'Tera Shift', teraType: 'Stellar' });
const hatterene = (): PokemonSet => set('Hatterene', ['Expanding Force', 'Splash']);
const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });
const psychic = (battle: Battle) => { battle.field.setTerrain('psychicterrain', 'debug'); };

const STARSTORM = 'move terastarstorm 1 terastallize, move splash';
const FORCE = 'move expandingforce 1, move splash';
const IDLE = 'move splash, move splash';
const IDLE_ALONE = 'move splash, pass';

/** A doubles battle; `alone` leaves the first foe the only one alive (the second of its two fainted). */
const doubles = (p1: PokemonSet[], foes: PokemonSet[], setup?: (battle: Battle) => void, alone = false): SimPosition =>
  rootOf('gen9doublescustomgame', p1, foes, battle => {
    if (alone) {
      battle.sides[1].active[1]!.faint();
      battle.resolveFaints();
    }
    setup?.(battle);
  });

function holds(root: SimPosition, p1Choice: string, idle = IDLE): { rolls: number; allHold: boolean } {
  const checked = checkedRolls(drawTurn(root, p1Choice, idle));
  return { rolls: checked.length, allHold: checked.every(entry => entry.holds) };
}

describe('doubles: the kill table of the hit the simulator plays', () => {
  test('Tera Starstorm after the click into two foes: one table per foe, both the simulator\'s', () => {
    const root = doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')]);
    expect(holds(root, STARSTORM)).toEqual({ rolls: 2, allHold: true });
  });

  test('Tera Starstorm after the click into one foe carries no spread factor', () => {
    const root = doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')], undefined, true);
    expect(holds(root, STARSTORM, IDLE_ALONE)).toEqual({ rolls: 1, allHold: true });
  });

  test('Expanding Force of a grounded user in Psychic Terrain: two foes spread, one foe does not', () => {
    expect(holds(doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')], psychic), FORCE)).toEqual({ rolls: 2, allHold: true });
    expect(holds(doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')], psychic, true), FORCE, IDLE_ALONE)).toEqual({ rolls: 1, allHold: true });
  });

  test('Expanding Force outside the terrain hits the one foe it names', () => {
    expect(holds(doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')]), FORCE)).toEqual({ rolls: 1, allHold: true });
  });
});

/** A foe HP at which about half of the simulator's normal rolls kill. */
function halfKilling(damages: readonly number[]): number {
  const hp = [...damages].sort((a, b) => a - b)[8];
  expect(killing(damages, hp)).toBeGreaterThan(0);
  expect(killing(damages, hp)).toBeLessThan(16);
  return hp;
}

describe('doubles: the option\'s headline names every foe the move hits', () => {
  const crit = critRate(9, 1)!;
  const fraction = (normal: readonly number[], crits: readonly number[], hp: number) => (1 - crit) * killing(normal, hp) / 16 + crit * killing(crits, hp) / 16;

  test('Tera Starstorm into two foes, the named one doomed: the headline is the other foe, with the simulator\'s spread rolls', () => {
    const make = (hp?: number) => doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')], battle => { if (hp) battle.sides[1].active[1]!.sethp(hp); battle.sides[1].active[0]!.sethp(1); });
    const damages = simDamages(make(), STARSTORM, IDLE, { script: 'p1a:terastarstorm>p2b', target: { side: 1, slot: 1 } });
    const hp = halfKilling(damages.normal);
    const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [STARSTORM]);
    expect(odds?.label).toBe('Tera Starstorm→Chansey');
    expect(odds?.killFraction).toBeCloseTo(fraction(damages.normal, damages.crit, hp), 10);
  });

  test('Tera Starstorm into one foe: the simulator\'s rolls without the spread factor', () => {
    const make = (hp?: number) => doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')], battle => { if (hp) battle.sides[1].active[0]!.sethp(hp); }, true);
    const damages = simDamages(make(), STARSTORM, IDLE_ALONE, { script: 'p1a:terastarstorm>p2a', target: { side: 1, slot: 0 } });
    const hp = halfKilling(damages.normal);
    const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [STARSTORM]);
    expect(odds?.killFraction).toBeCloseTo(fraction(damages.normal, damages.crit, hp), 10);
  });

  test('Expanding Force in Psychic Terrain into two foes names the foe it was not aimed at; outside the terrain it does not', () => {
    const make = (setup?: (battle: Battle) => void) => doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')],
      battle => { setup?.(battle); battle.sides[1].active[0]!.sethp(1); });
    const damages = simDamages(make(psychic), FORCE, IDLE, { script: 'p1a:expandingforce>p2b', target: { side: 1, slot: 1 } });
    const hp = halfKilling(damages.normal);
    const inTerrain = make(battle => { psychic(battle); battle.sides[1].active[1]!.sethp(hp); });
    const [odds] = pairKoOdds(positionBattle(inTerrain), 'p1', [FORCE]);
    expect(odds?.label).toBe('Expanding Force→Chansey');
    expect(odds?.killFraction).toBeCloseTo(fraction(damages.normal, damages.crit, hp), 10);
    // Outside the terrain it hits only the named foe, which is doomed at 1 HP: no uncertain kill to name.
    const outside = make(battle => { battle.sides[1].active[1]!.sethp(hp); });
    expect(pairKoOdds(positionBattle(outside), 'p1', [FORCE])[0]).toBeNull();
  });
});

describe('singles: nothing spreads, the odds stay the simulator\'s', () => {
  test('Tera Starstorm after the click and Expanding Force in Psychic Terrain', () => {
    const cases: [PokemonSet, string, string, (battle: Battle) => void, boolean][] = [
      [terapagos(), 'tera starstorm', 'move terastarstorm terastallize', () => undefined, true],
      [hatterene(), 'expanding force', 'move expandingforce', psychic, false],
    ];
    for (const [attacker, name, choice, setup, clicks] of cases) {
      const id = name.replace(' ', '');
      const make = (hp?: number) => rootOf('gen9customgame', [attacker], [wall()], battle => { setup(battle); if (hp) battle.sides[1].active[0]!.sethp(hp); });
      const damages = simDamages(make(), choice, 'move splash', { script: `p1a:${id}>p2a`, target: { side: 1, slot: 0 } });
      const hp = halfKilling(damages.normal);
      const battle = positionBattle(make(hp));
      const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], id, { attacker: clicks })!;
      expect(event.normalKillRolls).toBe(killing(damages.normal, hp));
      expect(event.critKillRolls).toBe(killing(damages.crit, hp));
    }
  });
});

describe('doubles: the preview of a hit on a lone foe', () => {
  test('Tera Starstorm of the armed Terapagos and Expanding Force in Psychic Terrain read the simulator\'s range without the spread factor', () => {
    const cases: [PokemonSet, string, string, string, (battle: Battle) => void][] = [
      [terapagos(), 'Tera Starstorm', 'terastarstorm', STARSTORM, () => undefined],
      [hatterene(), 'Expanding Force', 'expandingforce', FORCE, psychic],
    ];
    for (const [attacker, name, id, choice, setup] of cases) {
      const root = doubles([attacker, wall('Snorlax')], [wall(), wall('Chansey')], setup, true);
      const state = createBranchStateFromBattle(positionBattle(root), [], {});
      const [mon, foe] = [state.p1ActiveSlots[0]!, state.p2ActiveSlots[0]!];
      const option = { name, activeSlot: 0, slot: 1, pp: 8, maxpp: 8, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: true, targetOptions: [] };
      const damages = simDamages(root, choice, IDLE_ALONE, { script: `p1a:${id}>p2a`, target: { side: 1, slot: 0 } });
      const context = { gen: 9, gameType: 'Doubles' as const, terrain: setup === psychic ? 'psychicterrain' : '', defenderPartner: null, attackerPartnerAlive: true };
      const result = calcSingleDamageRange(id === 'terastarstorm' ? { ...mon, teraType: 'Stellar' } : mon, foe, option as never, context);
      const pct = (damage: number) => Math.round(damage / foe.maxhp * 1000) / 10;
      expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal)), pct(Math.max(...damages.normal))]);
    }
  });
});
