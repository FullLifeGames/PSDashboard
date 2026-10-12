import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { planCellEvents } from '../src/cell-blend';
import { advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { sampleCell } from '../src/search/cell-sampler';
import { classChildren } from '../src/search/outcome-children';
import { SEARCH_SEEDS } from '../src/search/leaf';

/**
 * Round 69 (T146 part c3): a status move that never reaches its accuracy roll has no miss class. The simulator
 * answers whether the roll is reached, for every cause alike (the type chart, an absorbing ability, Prankster
 * against Dark, powder against Grass): over natural seeds a `|-miss|` line appears exactly when the move can hit.
 * Singles only: a doubles root cell is priced by the pair plan from the dice that were drawn, and the analytic plan
 * gives up on its combined choices.
 */

const set = (species: string, moves: string[], ability = 'No Ability'): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Hardy',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
});

function scene(attacker: PokemonSet, defender: PokemonSet): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([attacker]) }, p2: { name: 'Beta', team: Teams.pack([defender]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

const P1 = 'move thunderwave';
const P2 = 'move recover';

/** Whether the simulator shows the attacker's miss line in any of 64 natural seeds. */
function simulatorMisses(root: SimPosition, p1Choice: string): boolean {
  for (let k = 0; k < 64; k++) {
    const { log } = advancePositionWithLog(root, p1Choice, P2, `${1000 + k},${2000 + k},${3000 + k},${4000 + k}` as never);
    if (log.some(line => line.startsWith('|-miss|p1a:'))) return true;
  }
  return false;
}

const cases: { name: string; attacker: PokemonSet; defender: PokemonSet; p1: string }[] = [
  { name: 'Thunder Wave into a Ground type', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Garchomp', ['Recover']), p1: P1 },
  { name: 'Thunder Wave into a Volt Absorb holder', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Lanturn', ['Recover'], 'Volt Absorb'), p1: P1 },
  { name: 'Prankster Thunder Wave into a Dark type', attacker: set('Pikachu', ['Thunder Wave'], 'Prankster'), defender: set('Umbreon', ['Recover']), p1: P1 },
  { name: 'Sleep Powder into a Grass type', attacker: set('Pikachu', ['Sleep Powder']), defender: set('Venusaur', ['Recover']), p1: 'move sleeppowder' },
  { name: 'Thunder Wave into a Water type (control)', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Starmie', ['Recover']), p1: P1 },
  // The Electric type is immune to paralysis, but only after the accuracy roll: the miss class is real here.
  { name: 'Thunder Wave into an Electric type (control)', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Jolteon', ['Recover']), p1: P1 },
];

describe('status events whose accuracy roll is never reached (T146 c3)', () => {
  for (const { name, attacker, defender, p1 } of cases) {
    test(`${name}: a miss class exactly when the simulator can miss`, () => {
      const root = scene(attacker, defender);
      const reachable = simulatorMisses(root, p1);
      const plan = planCellEvents(positionBattle(root), p1, P2);
      expect(plan.kind).toBe(reachable ? 'events' : 'none');
      const sample = sampleCell(root, 0, p1, P2, 3, createMatchupCache(), true);
      expect(sample.diagnostic).toBeUndefined();
      expect(sample.blend !== undefined).toBe(reachable);
      const children = classChildren(root, p1, P2, { baseSeeds: SEARCH_SEEDS.slice(0, 1), forcedCap: 4 });
      if (reachable) {
        expect(children?.children.some(child => child.key.endsWith(':miss'))).toBe(true);
      } else {
        expect(children === null || (children.missing.length === 0 && !children.children.some(child => child.key.endsWith(':miss')))).toBe(true);
      }
    });
  }

  test('the immune cases are in the table (the oracle sees no miss) and the controls miss', () => {
    const verdicts = cases.map(entry => simulatorMisses(scene(entry.attacker, entry.defender), entry.p1));
    expect(verdicts).toEqual([false, false, false, false, true, true]);
  });
});
