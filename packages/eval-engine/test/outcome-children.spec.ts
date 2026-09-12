import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';

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
