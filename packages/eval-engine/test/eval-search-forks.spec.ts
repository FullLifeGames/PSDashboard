import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { searchPosition, subSearchDepth1 } from '../src/search';
import { PROVER_BUDGET } from '../src/endgame/prover';
import { configureSimFast, resetSimFastForTests } from '../src/forward/sim-fast/state';

type DeserializeFn = typeof State.deserializeBattle;

// These tests count forks as State.deserializeBattle calls, which only the
// standard path makes; lever clone copies a template instead. They pin the
// standard path whatever EVAL_SIM_FAST or the default says.
beforeEach(() => configureSimFast([]));
afterEach(() => resetSimFastForTests());

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
  // Custom Game opens at team preview — commit the default order so the
  // leads are actually on the field.
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

describe('fork counts on the standard path', () => {
  test('roll grouping: quiet cells sample once, KO cells get the seed spread', () => {
    const original = State.deserializeBattle;
    let forks = 0;
    State.deserializeBattle = ((serialized: Parameters<DeserializeFn>[0]) => {
      forks += 1;
      return original.call(State, serialized);
    }) as DeserializeFn;
    // Round 35: a zero prover budget keeps this count about the matrix sampler.
    const proverStates = PROVER_BUDGET.states; PROVER_BUDGET.states = 0;
    try {
      // 2x2 all-quiet matrix (Protect/Substitute): every cell needs one sim.
      const quiet = serialize(makeBattle(
        [makeSet('A', 'Snorlax', ['Protect', 'Substitute'])],
        [makeSet('B', 'Chansey', ['Protect', 'Substitute'])],
      ));
      forks = 0;
      searchPosition(quiet, { depth: 1, samples: 3, tera: false });
      expect(forks).toBe(1 + 4); // root + 4 cells x 1 draw

      // Toss KOs Pikachu (bench Eevee continues the game): those cells are
      // roll-sensitive and take the full spread; quiet cells still take one.
      // The trend tiebreak's probe forks are the same in both runs, so the
      // s3−s1 delta isolates the sampling behavior.
      const violent = serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
        [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30)],
      ));
      forks = 0;
      searchPosition(violent, { depth: 1, samples: 1, tera: false });
      const forksSingle = forks;
      forks = 0;
      searchPosition(violent, { depth: 1, samples: 3, tera: false });
      const extraDraws = forks - forksSingle;
      const cells = 2 * 3; // 2 p1 options x 3 p2 options
      expect(extraDraws).toBeGreaterThan(0);           // some cells multi-sampled
      expect(extraDraws).toBeLessThan(cells * 2);      // but not all of them
    } finally {
      State.deserializeBattle = original;
      PROVER_BUDGET.states = proverStates;
    }
  });

  test('the score-focused sub-search prunes dominated rows', () => {
    const original = State.deserializeBattle;
    let forks = 0;
    State.deserializeBattle = ((serialized: Parameters<DeserializeFn>[0]) => {
      forks += 1;
      return original.call(State, serialized);
    }) as DeserializeFn;
    try {
      const root = serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect', 'Night Shade'], 100)],
        [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100), makeSet('Eevee', 'Eevee', ['Protect'], 100)],
      ));
      forks = 0;
      searchPosition(root, { depth: 1, samples: 1, tera: false });
      const fullForks = forks;
      forks = 0;
      subSearchDepth1(root, { depth: 1, samples: 1, tera: false });
      expect(forks).toBeLessThan(fullForks);
    } finally {
      State.deserializeBattle = original;
    }
  });

  test('Sleep Talk cells take the seed spread even without a KO (GPL T25)', () => {
    const original = State.deserializeBattle;
    let forks = 0;
    State.deserializeBattle = ((serialized: Parameters<DeserializeFn>[0]) => {
      forks += 1;
      return original.call(State, serialized);
    }) as DeserializeFn;
    try {
      // A sleeping Sleep Talker: which move comes out is pure seed — the
      // cell must not be judged off a single called move.
      const sleeper = () => {
        const battle = makeBattle(
          [makeSet('S', 'Snorlax', ['Sleep Talk', 'Protect'], 100)],
          [makeSet('C', 'Chansey', ['Protect', 'Substitute'], 100)],
        );
        battle.sides[0].active[0]!.setStatus('slp');
        return serialize(battle);
      };
      forks = 0;
      searchPosition(sleeper(), { depth: 1, samples: 1, tera: false });
      const single = forks;
      forks = 0;
      searchPosition(sleeper(), { depth: 1, samples: 3, tera: false });
      expect(forks).toBeGreaterThan(single);
    } finally {
      State.deserializeBattle = original;
    }
  });
});
