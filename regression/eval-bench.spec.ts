import { test } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { advancePosition, createRootPosition } from '../src/lib/eval/forward-model';
import { mctsSearch } from '../src/lib/eval/mcts';
import { searchPosition } from '../src/lib/eval/search';

function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
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

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

function makeSixVsSix(): Battle {
  const attacker = (name: string, species: string, moves: string[]) => makeSet(name, species, moves, 100);
  return makeBattle(
    [
      attacker('Machamp', 'Machamp', ['Close Combat', 'Knock Off', 'Bullet Punch', 'Protect']),
      attacker('Snorlax', 'Snorlax', ['Body Slam', 'Earthquake', 'Rest', 'Protect']),
      attacker('Dragapult', 'Dragapult', ['Dragon Darts', 'U-turn', 'Will-O-Wisp', 'Protect']),
      attacker('Kyurem', 'Kyurem', ['Draco Meteor', 'Ice Beam', 'Earth Power', 'Protect']),
      attacker('Corviknight', 'Corviknight', ['Brave Bird', 'Body Press', 'Roost', 'Protect']),
      attacker('Chansey', 'Chansey', ['Seismic Toss', 'Soft-Boiled', 'Stealth Rock', 'Protect']),
    ],
    [
      attacker('Garchomp', 'Garchomp', ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Protect']),
      attacker('Rotom-Wash', 'Rotom-Wash', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Protect']),
      attacker('Ferrothorn', 'Ferrothorn', ['Power Whip', 'Gyro Ball', 'Spikes', 'Protect']),
      attacker('Volcarona', 'Volcarona', ['Flamethrower', 'Bug Buzz', 'Quiver Dance', 'Protect']),
      attacker('Toxapex', 'Toxapex', ['Surf', 'Toxic', 'Recover', 'Protect']),
      attacker('Tyranitar', 'Tyranitar', ['Stone Edge', 'Crunch', 'Earthquake', 'Protect']),
    ],
  );
}

test.describe('eval engine benchmark', () => {
  test.skip(!process.env.EVAL_BENCH, 'set EVAL_BENCH=1 to run the benchmark');

  test('measures forward-model and search throughput', () => {
    test.setTimeout(300_000);
    const root = createRootPosition(serialize(makeSixVsSix()));

    const forks = 50;

    // Stage split: where does a fork's time actually go?
    const serialized = root.serialized;
    const deserializeStart = performance.now();
    for (let i = 0; i < forks; i++) State.deserializeBattle(serialized);
    console.log(`deserialize only: ${((performance.now() - deserializeStart) / forks).toFixed(1)} ms each`);

    const stageBattle = State.deserializeBattle(serialized);
    const serializeStart = performance.now();
    for (let i = 0; i < forks; i++) JSON.stringify(State.serializeBattle(stageBattle));
    console.log(`serialize only: ${((performance.now() - serializeStart) / forks).toFixed(1)} ms each`);

    const forkStart = performance.now();
    for (let i = 0; i < forks; i++) {
      advancePosition(root, 'move 1', 'move 1', '1,2,3,4');
    }
    const forkMs = performance.now() - forkStart;
    console.log(`advancePosition: ${(forks / (forkMs / 1000)).toFixed(1)} forks/sec (${(forkMs / forks).toFixed(1)} ms each)`);

    for (const settings of [{ depth: 1, samples: 1 }, { depth: 1, samples: 3 }, { depth: 2, samples: 1 }, { depth: 2, samples: 3 }] as const) {
      const start = performance.now();
      searchPosition(root.serialized, settings);
      console.log(`search depth=${settings.depth} samples=${settings.samples}: ${((performance.now() - start) / 1000).toFixed(1)}s`);
    }

    const mctsStart = performance.now();
    mctsSearch(root.serialized, { depth: 1, samples: 1, mode: 'mcts' });
    console.log(`mcts (600 iterations): ${((performance.now() - mctsStart) / 1000).toFixed(1)}s`);
  });
});
