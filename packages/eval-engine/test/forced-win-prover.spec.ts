import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { proveForcedWin, PROVER_BUDGET } from '../src/endgame/prover';
import { MIN_FORCED_MASS } from '../src/types';

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
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
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** Sets every listed body to `hp` (slot order per side) and serializes. */
function serializeAt(battle: Battle, hp: { p1?: number[]; p2?: number[] }): string {
  for (const side of ['p1', 'p2'] as const) {
    (hp[side] ?? []).forEach((value, index) => { battle.sides[side === 'p1' ? 0 : 1].pokemon[index].hp = value; });
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const tossVsEgg = () => serializeAt(makeBattle(
  [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Protect'])],
  [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
), { p2: [1] });

describe('forced-win prover (round 35)', () => {
  test('a certain knock-out proves in one turn with no caveat', () => {
    const proof = proveForcedWin(tossVsEgg(), { side: 'p1', rootOrder: ['move seismictoss', 'move protect'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(1);
    expect(proof.caveat).toBe('none');
    expect(proof.open).toBeUndefined();
    expect(proof.openValue).toBeNull();
  });

  test('a failing first candidate does not stop the proof', () => {
    // Splash first: the Chansey out-heals Seismic Toss for longer than the
    // depth cap allows (sixteen heals), so the Splash line proves nothing.
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Splash'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled', 'Recover'])],
    ), { p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move splash', 'move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(1);
  });

  test('the losing side proves nothing', () => {
    const proof = proveForcedWin(tossVsEgg(), { side: 'p2', rootOrder: ['move softboiled'], tera: false });
    expect(proof.mass).toBe(0);
  });

  test('a 70% roll proves its hit class and names the open miss', () => {
    const serialized = serializeAt(makeBattle(
      [{ ...makeSet('Jolt', 'Jolteon', ['Thunder']), evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 } }],
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
    ), { p1: [1], p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move thunder'], tera: false });
    expect(proof.mass).toBeCloseTo(0.7, 6);
    expect(proof.turns).toBe(1);
    expect(proof.caveat).toBe('none');
    expect(proof.open).toEqual({ side: 'p1', moveId: 'thunder', label: 'Thunder', odds: 0.7, kind: 'hit' });
    // The miss child ends with Machamp's answer: the open branch is a lost game.
    expect(proof.openValue).toBe(-1);
  });

  test('a singles speed tie with mutual knock-outs proves exactly one half', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('A', 'Pikachu', ['Tackle'])],
      [makeSet('B', 'Pikachu', ['Tackle'])],
    ), { p1: [1], p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move tackle'], tera: false });
    expect(proof.mass).toBeCloseTo(0.5, 6);
    expect(proof.mass).toBeGreaterThanOrEqual(MIN_FORCED_MASS);
    expect(proof.openValue).toBe(-1);
  });

  test('the greedy probe spends a few cells on a hopeless position and no full proof', () => {
    // Protect and Substitute on both sides: no line ends, so the probe fails
    // every candidate inside its own budget and the tree search never starts.
    const serialized = serializeAt(makeBattle(
      [makeSet('A', 'Snorlax', ['Protect', 'Substitute'])],
      [makeSet('B', 'Chansey', ['Protect', 'Substitute'])],
    ), {});
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move protect', 'move substitute'], tera: false });
    expect(proof.mass).toBe(0);
    expect(proof.states).toBe(0);
    expect(proof.cells).toBeLessThanOrEqual(PROVER_BUDGET.probeCells);
  });

  test('a two-turn proof against four replies fits the budget after the probe', () => {
    // Seismic Toss twice against a 150-HP Chansey with four harmless moves:
    // four replies at the root, four children each proving in one more turn.
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Splash', 'Growl', 'Tail Whip', 'Defense Curl'])],
    ), { p2: [150] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.cells).toBeLessThanOrEqual(PROVER_BUDGET.cells);
  });

  test('a class no draw showed inherits the proof of the class that dominates it', () => {
    // Toxic hits 90% of the time; the inner cells draw three seeds, which
    // often never miss. A miss of the opponent's move is never better for
    // them than the hit, so the missing class inherits the hit class's proof
    // and the two Seismic Tosses prove with the full mass.
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Toxic', 'Splash', 'Growl', 'Tail Whip'])],
    ), { p2: [150] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
  });

  test('a two-turn win needs the budget; one state cannot prove it', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Egg2', 'Chansey', ['Soft-Boiled'])],
    ), { p2: [1, 1] });
    const starved = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false, budget: { states: 1 } });
    expect(starved.mass).toBe(0);
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.states).toBeLessThanOrEqual(PROVER_BUDGET.states);
    expect(proof.states).toBeLessThanOrEqual(4);
  });

  test('a surviving defender along the line labels the proof barring a crit', () => {
    // Thunderbolt kills the Machamp on some rolls and leaves it in range
    // on the rest; it cannot hurt back (Splash), so both classes prove and
    // the survived hit, unpriced for a crit, labels the proof.
    const serialized = serializeAt(makeBattle(
      [{ ...makeSet('Jolt', 'Jolteon', ['Thunderbolt']), evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 } }],
      [makeSet('Champ', 'Machamp', ['Splash'])],
    ), { p2: [165] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move thunderbolt'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.caveat).toBe('barring-crit');
  });

  test('fixed damage cannot crit, so a Seismic Toss line proves without the label', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Splash'])],
    ), { p2: [150] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(2);
    expect(proof.caveat).toBe('none');
  });

  test('doubles: a plain-path proof carries the sampled-rolls label', () => {
    // A doubles field needs two slots per side: the Chansey's partner has fainted.
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Champ2', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    battle.sides[1].active[1]!.faint();
    battle.faintMessages();
    const serialized = serializeAt(battle, { p2: [1] });
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: [], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(1);
    expect(proof.caveat).toBe('sampled-rolls');
  });
});
