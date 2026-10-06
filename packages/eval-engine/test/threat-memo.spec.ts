import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, pairThreat, threatGetter } from '../src/score/threat';

/**
 * Round 49: the matchup memo must be a function of its key. Super Fang,
 * Nature's Madness and Ruination deal half the target's CURRENT HP, the one
 * live-state read inside the memoized threat, and the key did not carry it:
 * the first forked position to ask froze its HP into the memo for the whole
 * search. The bank read stale values in a fixed order; the app, where a
 * worker pool splits one matrix, read a different value run to run.
 */

const makeSet = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves,
  nature: 'Hardy',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

function makeBattle(p1: PokemonSet, p2: PokemonSet): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([p1]) },
    p2: { name: 'Beta', team: Teams.pack([p2]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

describe('matchup memo (round 49)', () => {
  for (const [species, move] of [['Ting-Lu', 'ruination'], ['Raticate', 'superfang'], ['Tapu Lele', 'naturesmadness']] as const) {
    test(`${move} prices off the defender's current HP, through the memo as without it`, () => {
      const battle = makeBattle(makeSet(species, [move]), makeSet('Blissey', ['softboiled']));
      const attacker = battle.sides[0].active[0];
      const defender = battle.sides[1].active[0];
      const cached = threatGetter(battle, createMatchupCache());
      const best = (threat: { physical: number; special: number }) => Math.max(threat.physical, threat.special);

      const full = cached(attacker, defender);
      expect(full).toEqual(pairThreat(attacker, defender, battle));
      expect(best(full)).toBeCloseTo(0.5, 2);

      // The same pair later in the search, the defender at a quarter: half of what is LEFT.
      defender.hp = Math.floor(defender.maxhp / 4);
      const low = cached(attacker, defender);
      expect(low).toEqual(pairThreat(attacker, defender, battle));
      expect(best(low)).toBeCloseTo(0.125, 2);
    });
  }

  // The review of the HP fix found the same leak on the types and the stored
  // stats: both are live reads of the memoized function that a turn can change
  // without touching species, item, ability or the slots.
  test('a type change on either side reaches the memo (Protean, Soak)', () => {
    const battle = makeBattle(makeSet('Meowscarada', ['knockoff', 'flowertrick']), makeSet('Gholdengo', ['shadowball']));
    const attacker = battle.sides[0].active[0];
    const defender = battle.sides[1].active[0];
    const cached = threatGetter(battle, createMatchupCache());
    const before = cached(attacker, defender);
    // Protean after Flower Trick: pure Grass, Knock Off loses its STAB.
    attacker.setType('Grass');
    expect(cached(attacker, defender)).toEqual(pairThreat(attacker, defender, battle));
    expect(cached(attacker, defender).physical).toBeLessThan(before.physical * 0.8);
    // Soak on the defender: the Ghost weakness to Knock Off is gone.
    const grass = cached(attacker, defender);
    defender.setType('Water');
    expect(cached(attacker, defender)).toEqual(pairThreat(attacker, defender, battle));
    expect(cached(attacker, defender).physical).not.toBe(grass.physical);
  });

  // Round 54: a Tera click changes nothing the key carried. The sim keeps
  // `types` at the old types and holds the new one in `terastallized`, so the
  // body before and after the click shared one entry, in both directions.
  // Under `tera: 'auto'` the app searches both bodies in one tree.
  test('a Tera click reaches the memo, as attacker and as defender', () => {
    const battle = makeBattle(
      { ...makeSet('Ceruledge', ['splash', 'bitterblade']), teraType: 'Fighting' },
      makeSet('Zamazenta', ['splash', 'bodypress']),
    );
    const ceruledge = battle.sides[0].active[0];
    const zamazenta = battle.sides[1].active[0];
    const cache = createMatchupCache();
    const cached = threatGetter(battle, cache);
    cached(ceruledge, zamazenta);
    cached(zamazenta, ceruledge);
    expect(cache.size).toBe(2);

    battle.choose('p1', 'move 1 terastallize');
    battle.choose('p2', 'move 1');
    expect(ceruledge.terastallized).toBe('Fighting');
    cached(ceruledge, zamazenta);
    cached(zamazenta, ceruledge);
    expect(cache.size).toBe(4);
  });

  test('a stored-stat swap reaches the memo (Power Trick)', () => {
    const battle = makeBattle(makeSet('Shuckle', ['rockslide', 'powertrick']), makeSet('Blissey', ['softboiled']));
    const attacker = battle.sides[0].active[0];
    const defender = battle.sides[1].active[0];
    const cached = threatGetter(battle, createMatchupCache());
    const before = cached(attacker, defender);
    [attacker.storedStats.atk, attacker.storedStats.def] = [attacker.storedStats.def, attacker.storedStats.atk];
    expect(cached(attacker, defender)).toEqual(pairThreat(attacker, defender, battle));
    expect(cached(attacker, defender).physical).toBeGreaterThan(before.physical * 2);
  });

  test('a pair without a halving move keeps ONE memo entry across the defender\'s HP', () => {
    const battle = makeBattle(makeSet('Garchomp', ['earthquake', 'seismictoss']), makeSet('Blissey', ['softboiled']));
    const attacker = battle.sides[0].active[0];
    const defender = battle.sides[1].active[0];
    const cache = createMatchupCache();
    const cached = threatGetter(battle, cache);
    const full = cached(attacker, defender);
    defender.hp = Math.floor(defender.maxhp / 4);
    expect(cached(attacker, defender)).toEqual(full);
    expect(cached(attacker, defender)).toEqual(pairThreat(attacker, defender, battle));
    expect(cache.size).toBe(1);
  });
});

describe('the memo keys the move answer (round 57)', () => {
  const withAbility = (species: string, moves: string[], ability: string): PokemonSet => ({ ...makeSet(species, moves), ability });

  test('Weather Ball: a weather change misses the memo', () => {
    const battle = makeBattle(withAbility('Pelipper', ['weatherball'], 'Drizzle'), makeSet('Gengar', ['splash']));
    const [pelipper, gengar] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cache = createMatchupCache();
    const cached = threatGetter(battle, cache);
    expect(cached(pelipper, gengar)).toEqual(pairThreat(pelipper, gengar, battle));
    battle.field.clearWeather();
    expect(cached(pelipper, gengar)).toEqual(pairThreat(pelipper, gengar, battle));
    expect(cache.size).toBe(2);
  });

  test('Terrain Pulse: a terrain change misses the memo', () => {
    const battle = makeBattle(withAbility('Indeedee', ['terrainpulse'], 'Psychic Surge'), makeSet('Gengar', ['splash']));
    const [indeedee, gengar] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cache = createMatchupCache();
    const cached = threatGetter(battle, cache);
    expect(cached(indeedee, gengar)).toEqual(pairThreat(indeedee, gengar, battle));
    battle.field.clearTerrain();
    expect(cached(indeedee, gengar)).toEqual(pairThreat(indeedee, gengar, battle));
    expect(cache.size).toBe(2);
  });

  test('Tera Blast: a stage change that flips the category misses the memo', () => {
    const battle = makeBattle({ ...makeSet('Gardevoir', ['splash', 'terablast']), teraType: 'Fighting' }, makeSet('Snorlax', ['splash']));
    battle.choose('p1', 'move 1 terastallize');
    battle.choose('p2', 'move 1');
    const [gardevoir, snorlax] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cached = threatGetter(battle, createMatchupCache());
    expect(cached(gardevoir, snorlax)).toEqual(pairThreat(gardevoir, snorlax, battle));
    gardevoir.boosts.atk = 6;
    gardevoir.boosts.spa = -6;
    expect(cached(gardevoir, snorlax)).toEqual(pairThreat(gardevoir, snorlax, battle));
  });
});

describe('the memo keys the power at use (round 63, T81)', () => {
  /** The change must move the answer, and the memo must answer like a fresh reading after it. */
  function missesTheMemo(attacker: PokemonSet, defender: PokemonSet, change: (user: Pokemon, target: Pokemon, battle: Battle) => void) {
    const battle = makeBattle(attacker, defender);
    const [user, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cached = threatGetter(battle, createMatchupCache());
    const before = cached(user, target);
    expect(before).toEqual(pairThreat(user, target, battle));
    change(user, target, battle);
    const after = cached(user, target);
    expect(after).toEqual(pairThreat(user, target, battle));
    expect(after).not.toEqual(before);
  }

  test("Flail and Endeavor: the user's HP misses the memo", () => {
    for (const move of ['flail', 'endeavor']) {
      missesTheMemo(makeSet('Kingambit', [move]), makeSet('Snorlax', ['splash']), user => { user.hp = Math.floor(user.maxhp / 10); });
    }
  });

  test("Brine and Crush Grip: the target's HP misses the memo", () => {
    for (const move of ['brine', 'crushgrip']) {
      missesTheMemo(makeSet('Kingambit', [move]), makeSet('Snorlax', ['splash']), (_, target) => { target.hp = Math.floor(target.maxhp / 3); });
    }
  });

  test('Facade and Hex: a status misses the memo', () => {
    missesTheMemo(makeSet('Ursaluna', ['facade']), makeSet('Snorlax', ['splash']), user => { user.setStatus('brn'); });
    missesTheMemo(makeSet('Gengar', ['hex']), makeSet('Garchomp', ['splash']), (_, target) => { target.setStatus('par'); });
  });

  test('Solar Beam: the weather misses the memo', () => {
    missesTheMemo(makeSet('Venusaur', ['solarbeam']), makeSet('Garchomp', ['splash']), (_, __, battle) => {
      battle.field.setWeather('raindance', 'debug');
    });
  });

  test('Gyro Ball: a speed stage and Tailwind miss the memo', () => {
    missesTheMemo(makeSet('Ferrothorn', ['gyroball']), makeSet('Weavile', ['splash']), (_, target) => { target.boosts.spe = 2; });
    missesTheMemo(makeSet('Ferrothorn', ['gyroball']), makeSet('Weavile', ['splash']), (_, target) => {
      target.side.addSideCondition('tailwind', 'debug');
    });
  });

  test('Low Kick: a weight change misses the memo', () => {
    missesTheMemo(makeSet('Machamp', ['lowkick']), makeSet('Snorlax', ['splash']), (_, target) => { target.weighthg = 1; });
  });

  test('Knock Off: the target losing its item misses the memo', () => {
    missesTheMemo(makeSet('Weavile', ['knockoff']), { ...makeSet('Garchomp', ['splash']), item: 'Leftovers' }, (_, target) => { target.item = ''; });
  });

  test("Dragon Darts in doubles: the foe's partner fainting misses the memo", () => {
    const battle = new Battle({
      formatid: toID('gen9doublescustomgame'),
      seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([makeSet('Dragapult', ['dragondarts']), makeSet('Pikachu', ['splash'])]) },
      p2: { name: 'Beta', team: Teams.pack([makeSet('Snorlax', ['splash']), makeSet('Garchomp', ['splash'])]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    const [pult, lax] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cached = threatGetter(battle, createMatchupCache());
    const split = cached(pult, lax);
    expect(split).toEqual(pairThreat(pult, lax, battle));
    battle.sides[1].active[1].faint();
    battle.faintMessages();
    expect(cached(pult, lax)).toEqual(pairThreat(pult, lax, battle));
    expect(cached(pult, lax)).not.toEqual(split);
  });
});
