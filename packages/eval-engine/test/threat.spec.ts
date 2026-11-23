import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, pairThreat, threatGetter, boostedFraction, singleMoveFraction } from '../src/score/threat';
import { battleOf, powerInTurn } from './power-oracle';
import { expectedRate } from '../src/score/unanswered';
import { combinedOptionHints } from '../src/search/hints';
import { ScriptedPRNG } from '../src/forward/scripted-prng';
import { active, set } from './move-oracle';
import { doublesRoot } from './pair-battles';
import { hazardEntryFraction } from '../src/score/hazards';
import { evalFeatures } from '../src/score/features';

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

  test('a Stellar body spending its boost on a type misses the memo', () => {
    const battle = makeBattle({ ...makeSet('Garchomp', ['splash', 'earthquake']), teraType: 'Stellar' }, makeSet('Snorlax', ['splash']));
    battle.choose('p1', 'move 1 terastallize');
    battle.choose('p2', 'move 1');
    const [chomp, lax] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cached = threatGetter(battle, createMatchupCache());
    const fresh = cached(chomp, lax);
    expect(fresh).toEqual(pairThreat(chomp, lax, battle));
    chomp.stellarBoostedTypes.push('Ground');
    expect(cached(chomp, lax)).toEqual(pairThreat(chomp, lax, battle));
    expect(cached(chomp, lax)).not.toEqual(fresh);
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
    battle.resolveFaints();
    expect(cached(pult, lax)).toEqual(pairThreat(pult, lax, battle));
    expect(cached(pult, lax)).not.toEqual(split);
  });
});

/**
 * Round 64 (T125, point 1): Body Press reads the user's Defense and Foul Play
 * the target's Attack (the Dex's overrideOffensiveStat and
 * overrideOffensivePokemon), and the key carried neither. Guard Split and
 * Power Split write those stored stats without touching the four the key
 * did carry, so a pair asked before the split kept its old answer for the
 * whole search. The splits run in the simulator here.
 */
describe('the memo keys the stats a move reads off its axis (round 64, T125)', () => {
  /** The pair is asked before the turn; after it the memo must answer like a fresh reading, and the answer must have moved. */
  function missesAfter(battle: Battle, attacker: Pokemon, defender: Pokemon, turn: { p1: string; p2: string }, moved: () => boolean) {
    const cached = threatGetter(battle, createMatchupCache());
    const before = cached(attacker, defender);
    expect(before).toEqual(pairThreat(attacker, defender, battle));
    battle.choose('p1', turn.p1);
    battle.choose('p2', turn.p2);
    expect(moved()).toBe(true);
    expect(cached(attacker, defender)).toEqual(pairThreat(attacker, defender, battle));
    expect(cached(attacker, defender)).not.toEqual(before);
  }

  test("singles: Guard Split, then Body Press against a benched foe reads the user's new Defense", () => {
    const battle = battleOf('gen9customgame',
      [makeSet('Corviknight', ['bodypress', 'guardsplit'])], [makeSet('Shuckle', ['splash']), makeSet('Blissey', ['splash'])]);
    const corviknight = battle.sides[0].active[0];
    const def = corviknight.storedStats.def;
    missesAfter(battle, corviknight, battle.sides[1].pokemon[1], { p1: 'move 2', p2: 'move 1' }, () => corviknight.storedStats.def > def);
  });

  test("singles: Power Split, then Foul Play from the bench reads the target's new Attack", () => {
    const battle = battleOf('gen9customgame',
      [makeSet('Tauros', ['splash']), makeSet('Sableye', ['foulplay'])], [makeSet('Machamp', ['powersplit'])]);
    const machamp = battle.sides[1].active[0];
    const atk = machamp.storedStats.atk;
    missesAfter(battle, battle.sides[0].pokemon[1], machamp, { p1: 'move 1', p2: 'move 1' }, () => machamp.storedStats.atk < atk);
  });

  test("doubles: Guard Split into the ally, then Body Press against a foe the split never touched", () => {
    const battle = battleOf('gen9doublescustomgame',
      [makeSet('Corviknight', ['bodypress', 'guardsplit']), makeSet('Shuckle', ['splash'])],
      [makeSet('Blissey', ['splash']), makeSet('Chansey', ['splash'])]);
    const corviknight = battle.sides[0].active[0];
    const def = corviknight.storedStats.def;
    missesAfter(battle, corviknight, battle.sides[1].active[0], { p1: 'move 2 -2, move 1', p2: 'move 1, move 1' },
      () => corviknight.storedStats.def > def);
  });

  test("doubles: Power Split into the foe's ally, then Foul Play against the splitter", () => {
    const battle = battleOf('gen9doublescustomgame',
      [makeSet('Sableye', ['foulplay']), makeSet('Tauros', ['splash'])],
      [makeSet('Machamp', ['powersplit']), makeSet('Snorlax', ['splash'])]);
    const machamp = battle.sides[1].active[0];
    const atk = machamp.storedStats.atk;
    missesAfter(battle, battle.sides[0].active[0], machamp, { p1: 'move 1 1, move 1', p2: 'move 1 -2, move 1' },
      () => machamp.storedStats.atk !== atk);
  });
});

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

/** The simulator's damage in a real turn, the roll pinned to the maximum, a sure hit, no crit. */
function simDamage(format: string, attacker: PokemonSet[], defender: PokemonSet[], id: string, p1 = 'move 1', p2 = 'move 1'): number {
  const battle = battleOf(format, attacker, defender);
  const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([[`p1:${id}`, { hit: true, crit: false, roll: 0 }]]));
  prng.attach(battle);
  battle.prng = prng;
  const target = battle.sides[1].active[0];
  const before = target.hp;
  battle.choose('p1', p1);
  battle.choose('p2', p2);
  return before - target.hp;
}

/** Our fraction, in HP, against the simulator's damage: the static's formula skips the sim's rounding steps. */
function expectNearSim(format: string, attacker: PokemonSet[], defender: PokemonSet[], id: string, p1?: string, p2?: string) {
  const battle = battleOf(format, attacker, defender);
  const ours = singleMoveFraction(battle.sides[0].active[0], battle.sides[1].active[0], id, battle) * battle.sides[1].active[0].maxhp;
  const sim = simDamage(format, attacker, defender, id, p1, p2);
  expect(Math.abs(ours - sim) / sim, `${id}: ours ${ours.toFixed(1)} against the sim's ${sim}`).toBeLessThan(0.03);
}

const pair = (battle: Battle): [Pokemon, Pokemon] => [active(battle, 0), active(battle, 1)];

describe('stat axes from the Dex (round 63, T81)', () => {
  test("Body Press deals damage off the user's Defense, Psyshock against the target's Defense, Foul Play off the target's Attack", () => {
    expectNearSim('gen9customgame', [set('Corviknight', ['bodypress'], { evs: { hp: 0, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } })], [splash('Snorlax')], 'bodypress');
    expectNearSim('gen9customgame', [set('Espeon', ['psyshock'])], [splash('Blissey')], 'psyshock');
    expectNearSim('gen9customgame', [set('Sableye', ['foulplay'])], [splash('Kingambit')], 'foulplay');
    // Doubles: Body Press into one foe of two.
    expectNearSim('gen9doublescustomgame',
      [set('Corviknight', ['bodypress'], { evs: { hp: 0, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), splash('Pikachu')],
      [splash('Snorlax'), splash('Garchomp')], 'bodypress', 'move 1 1, move 1', 'move 1, move 1');
  });

  test('Choice Band boosts Body Press, Assault Vest does not guard against Psyshock', () => {
    expectNearSim('gen9customgame', [set('Corviknight', ['bodypress'], { item: 'Choice Band' })], [splash('Snorlax')], 'bodypress');
    // An Assault Vest holder cannot click Splash (a status move); Seismic Toss leaves its own HP alone.
    expectNearSim('gen9customgame', [set('Espeon', ['psyshock'])], [set('Blissey', ['seismictoss'], { item: 'Assault Vest' })], 'psyshock');
  });

  test('stages follow the axis', () => {
    const press = battleOf('gen9customgame', [set('Corviknight', ['bodypress'])], [splash('Snorlax')]);
    const [corv, lax] = pair(press);
    const pressThreat = pairThreat(corv, lax, press);
    const flat = boostedFraction(pressThreat, corv, lax);
    expect(flat).toBeGreaterThan(0);
    corv.boosts.atk = 2;
    expect(boostedFraction(pressThreat, corv, lax)).toBeCloseTo(flat, 10);
    corv.boosts.def = 2;
    expect(boostedFraction(pressThreat, corv, lax)).toBeCloseTo(2 * flat, 10);
    expect(expectedRate(pressThreat, corv, lax)).toBeCloseTo(2 * flat, 10);

    const foul = battleOf('gen9customgame', [set('Sableye', ['foulplay'])], [splash('Kingambit')]);
    const [sableye, gambit] = pair(foul);
    const foulThreat = pairThreat(sableye, gambit, foul);
    const foulFlat = boostedFraction(foulThreat, sableye, gambit);
    sableye.boosts.atk = 2;
    expect(boostedFraction(foulThreat, sableye, gambit)).toBeCloseTo(foulFlat, 10);
    gambit.boosts.atk = 2;
    expect(boostedFraction(foulThreat, sableye, gambit)).toBeCloseTo(2 * foulFlat, 10);

    const shock = battleOf('gen9customgame', [set('Espeon', ['psyshock'])], [splash('Blissey')]);
    const [espeon, blissey] = pair(shock);
    const shockThreat = pairThreat(espeon, blissey, shock);
    const shockFlat = boostedFraction(shockThreat, espeon, blissey);
    blissey.boosts.spd = 2;
    expect(boostedFraction(shockThreat, espeon, blissey)).toBeCloseTo(shockFlat, 10);
    blissey.boosts.def = 2;
    expect(boostedFraction(shockThreat, espeon, blissey)).toBeCloseTo(shockFlat / 2, 10);
  });

  test('Iron Defense buys setup equity for a Body Press carrier and none for a carrier without it', () => {
    const hint = (moves: string[]) => {
      const root = doublesRoot([set('Corviknight', moves), splash('Pikachu')], [splash('Snorlax'), splash('Garchomp')]);
      return combinedOptionHints(root, 'p1', [{ choice: 'move irondefense, move splash', label: '' }])[0];
    };
    // Two status parts at the support floor each, unless a part buys equity.
    expect(hint(['irondefense', 'bravebird'])).toBe(0.5);
    expect(hint(['irondefense', 'bodypress'])).toBeGreaterThan(0.5);
  });

  test("Stored Power and Power Trip price through the stages with the simulator's callback (decision 3)", () => {
    for (const id of ['storedpower', 'powertrip']) {
      const battle = battleOf('gen9customgame', [set('Espeon', [id])], [splash('Garchomp')]);
      const [espeon, chomp] = pair(battle);
      const threat = pairThreat(espeon, chomp, battle);
      const flat = boostedFraction(threat, espeon, chomp);
      expect(flat, id).toBeGreaterThan(0);
      // At +2/+2 the simulator gives power 100 in a real turn; the category's stage doubles it again.
      espeon.boosts.atk = 2;
      espeon.boosts.spa = 2;
      espeon.boosts.spd = 2;
      espeon.boosts.def = 2;
      const offense = battle.dex.moves.get(id).category === 'Physical' ? 'atk' : 'spa';
      const seen = powerInTurn(battle, { p1: 'move 1', p2: 'move 1' }, id);
      expect(seen[0].basePower, id).toBe(180);
      espeon.boosts[offense === 'atk' ? 'atk' : 'spa'] = 2;
      expect(boostedFraction(threat, espeon, chomp), id).toBeCloseTo(flat * (180 / 20) * 2, 6);
    }
    // The override of a setup hint reaches the callback: Calm Mind's +1/+1 is worth 60 power at x1.5.
    const battle = battleOf('gen9customgame', [set('Espeon', ['storedpower'])], [splash('Garchomp')]);
    const [espeon, chomp] = pair(battle);
    const threat = pairThreat(espeon, chomp, battle);
    expect(boostedFraction(threat, espeon, chomp, { spa: 1, spd: 1 }))
      .toBeCloseTo(boostedFraction(threat, espeon, chomp) * (60 / 20) * 1.5, 6);
  });
});

describe('tera-statics', () => {
  type SetOptions = { item?: string; ability?: string; teraType?: string };

  const makeSet = (species: string, moves: string[], options: SetOptions = {}): PokemonSet => ({
    name: species, species, item: options.item ?? '', ability: options.ability ?? 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
    ...(options.teraType ? { teraType: options.teraType } : {}),
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

  /** p1 clicks Tera on a turn in which nobody deals damage (slot 1 is Splash on both sides). */
  function clickTera(battle: Battle) {
    battle.choose('p1', 'move 1 terastallize');
    battle.choose('p2', 'move 1');
    expect(battle.sides[0].active[0].terastallized).toBeTruthy();
  }

  describe('the defender type reads live after a Tera click (round 54)', () => {
    test('Body Press hits a Ceruledge that terastallized out of Ghost', () => {
      const battle = makeBattle(
        makeSet('Ceruledge', ['splash'], { teraType: 'Fighting' }),
        makeSet('Zamazenta', ['splash', 'bodypress']),
      );
      const [ceruledge, zamazenta] = [battle.sides[0].active[0], battle.sides[1].active[0]];
      expect(singleMoveFraction(zamazenta, ceruledge, 'bodypress', battle)).toBe(0);
      clickTera(battle);
      expect(singleMoveFraction(zamazenta, ceruledge, 'bodypress', battle)).toBeGreaterThan(0.3);
    });

    test('the type chart follows: Tera Fairy drops Gholdengo\'s Steel resistances', () => {
      const battle = makeBattle(
        makeSet('Gholdengo', ['splash'], { teraType: 'Fairy' }),
        makeSet('Dragonite', ['splash', 'outrage', 'ironhead']),
      );
      const [gholdengo, dragonite] = [battle.sides[0].active[0], battle.sides[1].active[0]];
      const steelBefore = singleMoveFraction(dragonite, gholdengo, 'ironhead', battle);
      clickTera(battle);
      // Dragon into Fairy is an immunity, Steel into Fairy is super effective (was resisted).
      expect(singleMoveFraction(dragonite, gholdengo, 'outrage', battle)).toBe(0);
      expect(singleMoveFraction(dragonite, gholdengo, 'ironhead', battle)).toBeCloseTo(steelBefore * 4, 6);
    });

    test('a Stellar Tera keeps the old types for defense', () => {
      const battle = makeBattle(
        makeSet('Ceruledge', ['splash'], { teraType: 'Stellar' }),
        makeSet('Zamazenta', ['splash', 'bodypress']),
      );
      const [ceruledge, zamazenta] = [battle.sides[0].active[0], battle.sides[1].active[0]];
      clickTera(battle);
      expect(ceruledge.terastallized).toBe('Stellar');
      expect(singleMoveFraction(zamazenta, ceruledge, 'bodypress', battle)).toBe(0);
    });

    test('the memo answers like a fresh reading across the click', () => {
      const battle = makeBattle(
        makeSet('Ceruledge', ['splash'], { teraType: 'Fighting' }),
        makeSet('Zamazenta', ['splash', 'bodypress']),
      );
      const [ceruledge, zamazenta] = [battle.sides[0].active[0], battle.sides[1].active[0]];
      const cached = threatGetter(battle, createMatchupCache());
      expect(cached(zamazenta, ceruledge)).toEqual(pairThreat(zamazenta, ceruledge, battle));
      clickTera(battle);
      expect(cached(zamazenta, ceruledge)).toEqual(pairThreat(zamazenta, ceruledge, battle));
      // Body Press deals damage off the user's Defense (the Dex's overrideOffensiveStat), so since round 63
      // (T81) it keeps its own entry in PairThreat.axes instead of the physical bucket.
      expect(cached(zamazenta, ceruledge).axes?.find(axis => axis.offense === 'def')?.fraction).toBeGreaterThan(0.3);
    });

    describe('hazards', () => {
      const entryAcrossTheClick = (species: string, teraType: string, hazard: string) => {
        const battle = makeBattle(makeSet(species, ['splash'], { teraType }), makeSet('Blissey', ['splash']));
        const side = battle.sides[0];
        side.addSideCondition(hazard, battle.sides[1].active[0]);
        const before = hazardEntryFraction(side.active[0], side, battle);
        clickTera(battle);
        return { before, after: hazardEntryFraction(side.active[0], side, battle) };
      };

      test('Stealth Rock prices the Tera type: Garchomp resists Rock, Tera Fire is weak to it', () => {
        const { before, after } = entryAcrossTheClick('Garchomp', 'Fire', 'stealthrock');
        expect(before).toBeCloseTo(0.0625, 6);
        expect(after).toBeCloseTo(0.25, 6);
      });

      test('Toxic Spikes spare a body that terastallized to Steel', () => {
        const { before, after } = entryAcrossTheClick('Dragapult', 'Steel', 'toxicspikes');
        expect(before).toBeCloseTo(0.06, 6);
        expect(after).toBe(0);
      });

      // Grounding goes through the sim's isGrounded(), which saw Tera before this round.
      test('Spikes already follow the grounding in both directions', () => {
        expect(entryAcrossTheClick('Garchomp', 'Flying', 'spikes')).toEqual({ before: 0.125, after: 0 });
        expect(entryAcrossTheClick('Corviknight', 'Steel', 'spikes')).toEqual({ before: 0, after: 0.125 });
      });
    });

    test('Black Sludge feeds a holder that terastallized to Poison', () => {
      const battle = makeBattle(
        makeSet('Gholdengo', ['splash'], { teraType: 'Poison', item: 'Black Sludge' }),
        makeSet('Blissey', ['splash']),
      );
      // One full-HP body a side: the bodies term is the holder's item multiplier minus 1.
      expect(evalFeatures(battle).bodies).toBeCloseTo(-0.1, 6);
      clickTera(battle);
      expect(evalFeatures(battle).bodies).toBeCloseTo(0.03, 6);
    });
  });

  // STAB by the game's rules (old type 1.5, Tera type 1.5, both 2.0, Stellar
  // 2.0 and 1.2 on the first use of a type) was built and parked in round 54
  // (T71) and lands with T81 in round 63; test/threat.stab-rules.spec.ts holds it
  // against the damage the simulator deals. Blissey takes Ground and Fire
  // neutrally, so the ratio across the click is the STAB ratio.
  describe('STAB follows the Tera click (round 63, T81)', () => {
    test.each([['Ground', 'earthquake', 2 / 1.5], ['Fire', 'firefang', 1.5], ['Stellar', 'earthquake', 2 / 1.5]])(
      'Tera %s moves %s by x%f', (teraType, move, ratio) => {
        const battle = makeBattle(makeSet('Garchomp', ['splash', move], { teraType }), makeSet('Blissey', ['splash']));
        const [garchomp, blissey] = [battle.sides[0].active[0], battle.sides[1].active[0]];
        const before = singleMoveFraction(garchomp, blissey, move, battle);
        clickTera(battle);
        expect(singleMoveFraction(garchomp, blissey, move, battle) / before).toBeCloseTo(ratio, 10);
      });

    test('the same in doubles: Tera Ground Earthquake into either foe', () => {
      const battle = new Battle({
        formatid: toID('gen9doublescustomgame'),
        seed: '1,2,3,4',
        p1: { name: 'Alpha', team: Teams.pack([makeSet('Garchomp', ['splash', 'earthquake'], { teraType: 'Ground' }), makeSet('Pikachu', ['splash'])]) },
        p2: { name: 'Beta', team: Teams.pack([makeSet('Blissey', ['splash']), makeSet('Chansey', ['splash'])]) },
      });
      if (battle.sides.some(side => side.requestState === 'teampreview')) {
        battle.choose('p1', 'team 12');
        battle.choose('p2', 'team 12');
      }
      const garchomp = battle.sides[0].active[0];
      const before = battle.sides[1].active.map(foe => singleMoveFraction(garchomp, foe, 'earthquake', battle));
      battle.choose('p1', 'move 1 terastallize, move 1');
      battle.choose('p2', 'move 1, move 1');
      expect(garchomp.terastallized).toBe('Ground');
      battle.sides[1].active.forEach((foe, index) =>
        expect(singleMoveFraction(garchomp, foe, 'earthquake', battle) / before[index]).toBeCloseTo(2 / 1.5, 10));
    });
  });

  describe('abilities that blank a move flag (round 54)', () => {
    const fraction = (attacker: PokemonSet, defender: PokemonSet, move: string): number => {
      const battle = makeBattle(attacker, defender);
      return singleMoveFraction(battle.sides[0].active[0], battle.sides[1].active[0], move, battle);
    };

    // gen9doublesou-2660822493 t2: Hurricane into Shiftry priced 277 % of its HP, the calc 0.
    test('Wind Rider takes no wind move; Wind Power still does', () => {
      const tornadus = makeSet('Tornadus', ['hurricane']);
      expect(fraction(tornadus, makeSet('Shiftry', ['splash'], { ability: 'Wind Rider' }), 'hurricane')).toBe(0);
      expect(fraction(tornadus, makeSet('Shiftry', ['splash'], { ability: 'Wind Power' }), 'hurricane')).toBeGreaterThan(1);
    });

    test('Soundproof takes no sound move, Bulletproof no ball or bomb', () => {
      const exploud = makeSet('Exploud', ['boomburst', 'shadowball']);
      expect(fraction(exploud, makeSet('Kommo-o', ['splash'], { ability: 'Soundproof' }), 'boomburst')).toBe(0);
      expect(fraction(exploud, makeSet('Kommo-o', ['splash'], { ability: 'Soundproof' }), 'shadowball')).toBeGreaterThan(0);
      expect(fraction(exploud, makeSet('Kommo-o', ['splash'], { ability: 'Bulletproof' }), 'shadowball')).toBe(0);
      expect(fraction(exploud, makeSet('Kommo-o', ['splash'], { ability: 'Bulletproof' }), 'boomburst')).toBeGreaterThan(0);
    });
  });
});
