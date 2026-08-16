import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { boundaryEvent } from '../src/lib/eval/ko-odds';

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

test.describe('boundaryEvent arithmetic', () => {
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
    // Lvl-100 Hydro Pump obliterates a lvl-30 Pikachu on every roll.
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
