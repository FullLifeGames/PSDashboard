import { describe, expect, test } from 'vitest';
import { Dex, type Battle, type ModdedDex, type PokemonSet } from '@pkmn/sim';
import { hitMayCost, hitReader, playedHit, type StatusCost } from '../src/score/contact';
import { MAX_PRICED_HITS, priceHit } from '../src/score/contact-price';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T225 (round 73): paralysis and sleep take turns, not HP, so a hit that leaves them costs the attacker the share of
 * its next turns on which it cannot move. The reader plays the turns on a copy of the hit (BeforeMove of the attacker
 * with the status on it) and hands the race the share of turns the body acts on, turn by turn after the hit landed
 * (`acts`). Every claim is held to real turns of the simulator: a body that carries the status clicks a move for four
 * turns on 200 seeds, and the share of seeds on which the move runs is the oracle. A status that never stops a move
 * (a burn, poison) carries no profile, and the sweep over the foe's items and abilities in both modes checks every
 * status the reader finds against the simulator, so that a status of a later version of the simulator that stops a
 * move cannot slip in unpriced.
 */

await loadSimMods('gen9championscustomgame');

const SEEDS = 200;
const TURNS = 4;
/** The slack between a share over 200 seeds and the reader's grid of 20 quantiles. */
const SLACK = 0.1;

const attacker = (extra: Partial<PokemonSet> = {}, move = 'ironhead') => set('Cobalion', [move, 'splash'], extra);
const foe = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

interface Mode { name: string; format: string; dex: ModdedDex | typeof Dex; extra: Partial<PokemonSet> }
const MODES: Mode[] = [
  { name: 'Scarlet and Violet', format: 'gen9customgame', dex: Dex.forGen(9), extra: {} },
  { name: 'Champions', format: 'gen9championscustomgame', dex: Dex.mod('champions'), extra: { level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } } },
];

const seedOf = (index: number) => `${index * 97 + 1},${index * 31 + 7},${index * 53 + 3},${index * 11 + 5}`;

/** One game type's board and its clicks: in doubles each side brings a Splashing partner. */
interface Shape { name: string; format: (mode: Mode) => string; board: (mode: Mode, seed: string, defender: PokemonSet, move?: string) => Battle; p1: string; p2: string }
const SINGLES: Shape = {
  name: 'singles',
  format: mode => mode.format,
  board: (mode, seed, defender, move) => battleOf(mode.format, [attacker(mode.extra, move)], [defender], seed),
  p1: 'move 1', p2: 'move 1',
};
const DOUBLES: Shape = {
  name: 'doubles',
  format: mode => mode.format.replace('customgame', 'doublescustomgame'),
  board: (mode, seed, defender, move) => battleOf(DOUBLES.format(mode), [attacker(mode.extra, move), foe('Clefable', mode.extra)], [defender, foe('Snorlax', mode.extra)], seed),
  p1: 'move 1 1, move 1', p2: 'move 1, move 1',
};

const oracles = new Map<string, number[]>();

/** The share of seeds on which a body that carries `status` runs its move, on each of its next turns, from real turns. */
function oracleOf(mode: Mode, shape: Shape, status: string): number[] {
  const key = `${mode.name}|${shape.name}|${status}`;
  let shares = oracles.get(key);
  if (!shares) {
    const ran = new Array<number>(TURNS).fill(0);
    for (let index = 0; index < SEEDS; index++) {
      // Tackle cannot finish the target in one turn, so the game outlasts the four turns the oracle plays.
      const battle = shape.board(mode, seedOf(index), foe('Chansey', mode.extra), 'tackle');
      battle.sides[0].active[0]!.setStatus(status);
      for (let turn = 0; turn < TURNS; turn++) {
        // The foe stands again every turn: a game that ends on the target stops the oracle.
        for (const foeMon of battle.sides[1].active) foeMon!.sethp(foeMon!.maxhp);
        const from = battle.log.length;
        battle.choose('p1', shape.p1);
        battle.choose('p2', shape.p2);
        if (battle.log.slice(from).some(line => line.startsWith('|move|p1a:'))) ran[turn]++;
      }
    }
    shares = ran.map(count => count / SEEDS);
    oracles.set(key, shares);
  }
  return shares;
}

const SHAPES = [SINGLES, DOUBLES];
const readStatus = (battle: Battle, status: string): StatusCost | undefined =>
  hitReader(battle)(battle.sides[0].active[0]!, battle.sides[1].active[0]!, 'ironhead').statuses.find(entry => entry.status === status);

describe.each(MODES)('the turns a status takes, $name', mode => {
  describe.each(SHAPES)('$name', shape => {
    test('the simulator: a paralyzed body runs its move on three of four turns, a sleeping one loses at least its first turn and mostly wakes by the fourth', () => {
      const par = oracleOf(mode, shape, 'par');
      for (const share of par) expect(share).toBeGreaterThan(0.6);
      for (const share of par) expect(share).toBeLessThan(0.9);
      const slp = oracleOf(mode, shape, 'slp');
      expect(slp[0]).toBe(0);
      expect(slp[TURNS - 1]).toBeGreaterThan(0.85);
      expect(slp[1]).toBeLessThan(slp[2]);
    });

    test('Static: the paralysis it leaves carries the share of turns the body still moves on, as the simulator plays them', () => {
      const cost = readStatus(shape.board(mode, '1,2,3,4', foe('Chansey', { ...mode.extra, ability: 'Static' })), 'par');
      expect(cost, 'Static leaves paralysis').toBeDefined();
      const oracle = oracleOf(mode, shape, 'par');
      expect(cost!.acts, 'the paralysis carries its turns').toBeDefined();
      for (let turn = 0; turn < TURNS; turn++) expect(Math.abs(cost!.acts![turn] - oracle[turn])).toBeLessThan(SLACK);
    });

    test('Effect Spore: the sleep it leaves carries its turns (the first lost, the wake-up inside three), the poison none', () => {
      const battle = shape.board(mode, '1,2,3,4', foe('Chansey', { ...mode.extra, ability: 'Effect Spore' }));
      const sleep = readStatus(battle, 'slp');
      expect(sleep, 'Effect Spore leaves sleep').toBeDefined();
      const oracle = oracleOf(mode, shape, 'slp');
      expect(sleep!.acts, 'the sleep carries its turns').toBeDefined();
      for (let turn = 0; turn < TURNS; turn++) expect(Math.abs(sleep!.acts![turn] - oracle[turn])).toBeLessThan(SLACK);
      expect(readStatus(battle, 'psn')?.acts).toBeUndefined();
    });
  });
});

describe.each(MODES)('every status a Dex reaction leaves, $name', mode => {
  const usable = <T extends { exists: boolean; isNonstandard?: string | null }>(entry: T): boolean =>
    entry.exists && (!entry.isNonstandard || entry.isNonstandard === 'Past');

  test('the profile of a status is the simulator\'s: stopped turns for the statuses that stop a move, none for the rest', { timeout: 300_000 }, () => {
    const names = [
      ...mode.dex.items.all().filter(usable).map(item => ({ item: item.name })),
      ...mode.dex.abilities.all().filter(usable).map(ability => ({ ability: ability.name })),
    ];
    const seen = new Map<string, StatusCost>();
    for (const extra of names) {
      const battle = battleOf(mode.format, [attacker(mode.extra)], [foe('Chansey', { ...mode.extra, ...extra })]);
      const [mine, theirs] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      if (!hitMayCost(battle, mine, theirs, 'ironhead')) continue;
      for (const entry of playedHit(battle, mine, theirs, 'ironhead').statuses) if (!seen.has(entry.status)) seen.set(entry.status, entry);
    }
    expect([...seen.keys()]).toEqual(expect.arrayContaining(['par', 'slp']));
    for (const [status, cost] of seen) {
      if (status.startsWith('item:')) { expect(cost.acts, status).toBeUndefined(); continue; }
      const oracle = oracleOf(mode, SINGLES, status);
      if (oracle.every(share => share === 1)) {
        expect(cost.acts, `${status} never stops a move`).toBeUndefined();
      } else {
        expect(cost.acts, `${status} stops moves`).toBeDefined();
        for (let turn = 0; turn < TURNS; turn++) expect(Math.abs(cost.acts![turn] - oracle[turn]), `${status} turn ${turn + 1}`).toBeLessThan(SLACK);
      }
    }
  });
});

describe('priceHit takes the turns a status costs out of the damage the side still lands', () => {
  const status = (acts?: readonly number[]): StatusCost => ({ status: 'par', chance: 1, chip: 0, output: 1, ...(acts ? { acts } : {}) });
  const cost = (acts?: readonly number[]) => ({ chip: 0, statuses: [status(acts)] });
  const full = new Array<number>(MAX_PRICED_HITS).fill(1);

  test('a certain paralysis that stops one turn in four prices a four-hit side by hand: the three hits after the landing one deal three quarters', () => {
    const acts = new Array<number>(MAX_PRICED_HITS).fill(0.75);
    // The first hit lands the status; hits 2 to 4 are the ones it takes from: 3 * 0.75 + 1 of 4.
    expect(priceHit(cost(acts), 4, 5, true).output).toBeCloseTo((1 + 3 * 0.75) / 4, 12);
  });

  test('a sleep that loses the first two turns and then wakes prices the hits in order, not their average', () => {
    const acts = [0, 0, ...new Array<number>(MAX_PRICED_HITS - 2).fill(1)];
    expect(priceHit(cost(acts), 3, 5, true).output).toBeCloseTo(1 / 3, 12);
    expect(priceHit(cost(acts), 6, 5, true).output).toBeCloseTo((6 - 2) / 6, 12);
  });

  test('no profile, or a profile of ones, prices as before the turns (a burn)', () => {
    expect(priceHit(cost(), 4, 5, true)).toEqual(priceHit(cost(full), 4, 5, true));
    expect(priceHit(cost(), 4, 5, true).output).toBe(1);
  });
});
