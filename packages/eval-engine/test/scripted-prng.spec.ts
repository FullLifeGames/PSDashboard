import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, positionBattle } from '../src/forward-model';
import type { RollScript, RollScripts } from '../src/forward/scripted-prng';

/**
 * Round 43: the simulator's dice on demand. A scripted PRNG answers the
 * accuracy roll, the crit roll, the damage roll and the speed-tie order of
 * one named move; everything else rolls from the seed as before.
 */

function makeSet(name: string, species: string, moves: string[], spe = 0, level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe },
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

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));
const scripts = (entries: Record<string, RollScript>): RollScripts => new Map(Object.entries(entries));

const jolt = () => makeSet('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt']);
const champ = () => makeSet('Champ', 'Machamp', ['Close Combat']);
const singlesRoot = (formatid = 'gen9customgame') => createRootPosition(serialize(makeBattle(formatid, [jolt()], [champ()])));
const champHp = (child: { child: { serialized: string } }) => positionBattle(child.child).sides[1].pokemon[0].hp;

describe('scripted PRNG (round 43)', () => {
  test('forces a Thunder miss and a Thunder hit on every seed', () => {
    const root = singlesRoot();
    for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12'] as const) {
      const miss = advancePositionWithLog(root, 'move thunder', 'move closecombat', seed, { scripts: scripts({ 'p1:thunder': { hit: false } }) });
      expect(miss.log.some(line => line.startsWith('|-miss|p1a: Jolt'))).toBe(true);
      const hit = advancePositionWithLog(root, 'move thunder', 'move closecombat', seed, { scripts: scripts({ 'p1:thunder': { hit: true } }) });
      expect(hit.log.some(line => line.startsWith('|-miss|p1a: Jolt'))).toBe(false);
      expect(hit.log.some(line => line.startsWith('|-damage|p2a: Champ'))).toBe(true);
    }
  });

  test('forces the damage roll (0 = maximum, 15 = minimum) and the crit', () => {
    const root = singlesRoot();
    const at = (roll: number, crit: boolean) => advancePositionWithLog(root, 'move thunderbolt', 'move closecombat', '1,2,3,4',
      { scripts: scripts({ 'p1:thunderbolt': { hit: true, crit, roll } }) });
    const max = at(0, false);
    const min = at(15, false);
    const critMax = at(0, true);
    expect(max.log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(false);
    expect(critMax.log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(true);
    const maxHp = positionBattle(root).sides[1].pokemon[0].maxhp;
    const ratio = (maxHp - champHp(min)) / (maxHp - champHp(max));
    expect(ratio).toBeGreaterThan(0.83);
    expect(ratio).toBeLessThan(0.87);
    expect(champHp(critMax)).toBeLessThan(champHp(max));
    // Deterministic: the same script twice is the same child.
    expect(at(7, false).child.serialized).toBe(at(7, false).child.serialized);
  });

  test('gen 6: the crit denominator 16 is not mistaken for the damage roll', () => {
    const root = singlesRoot('gen6customgame');
    const at = (roll: number, crit: boolean) => advancePositionWithLog(root, 'move thunderbolt', 'move closecombat', '1,2,3,4',
      { scripts: scripts({ 'p1:thunderbolt': { hit: true, crit, roll } }) });
    expect(at(15, true).log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(true);
    expect(at(0, false).log.some(line => line.startsWith('|-crit|p2a: Champ'))).toBe(false);
    expect(champHp(at(15, false))).toBeGreaterThan(champHp(at(0, false)));
  });

  test('forces the speed-tie order both ways', () => {
    const root = createRootPosition(serialize(makeBattle('gen9customgame',
      [makeSet('Alpha', 'Jolteon', ['Thunderbolt'], 252)], [makeSet('Beta', 'Jolteon', ['Thunderbolt'], 252)])));
    for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16'] as const) {
      for (const first of ['p1', 'p2'] as const) {
        const step = advancePositionWithLog(root, 'move thunderbolt', 'move thunderbolt', seed, { scripts: scripts({ 'p1:thunderbolt': { first } }) });
        const firstMove = step.log.find(line => line.startsWith('|move|'));
        expect(firstMove?.startsWith(`|move|${first}a:`)).toBe(true);
      }
    }
  });

  test('doubles: the named single-target move misses on demand while the partner rolls normally', () => {
    const root = createRootPosition(serialize(makeBattle('gen9doublescustomgame',
      [jolt(), makeSet('Lax', 'Snorlax', ['Body Slam'])],
      [champ(), makeSet('Chu', 'Pikachu', ['Tackle'], 0, 30)])));
    const step = advancePositionWithLog(root, 'move thunder 1, move bodyslam 1', 'move closecombat 1, move tackle 1', '1,2,3,4',
      { scripts: scripts({ 'p1:thunder': { hit: false } }) });
    expect(step.log.some(line => line.startsWith('|-miss|p1a: Jolt'))).toBe(true);
    expect(step.log.some(line => line.startsWith('|move|p1b: Lax|Body Slam'))).toBe(true);
  });

  test('without scripts the advance is byte-identical to the plain seed', () => {
    const root = singlesRoot();
    const plain = advancePositionWithLog(root, 'move thunder', 'move closecombat', '5,6,7,8');
    const empty = advancePositionWithLog(root, 'move thunder', 'move closecombat', '5,6,7,8', { scripts: new Map() });
    expect(empty.child.serialized).toBe(plain.child.serialized);
    expect(empty.log).toEqual(plain.log);
  });
});
