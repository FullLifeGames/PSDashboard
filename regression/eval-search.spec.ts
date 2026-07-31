import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { searchPosition } from '../src/lib/eval/search';
import type { EvalResult, SearchProgress } from '../src/lib/eval/types';

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

// Level-100 Machamp: Seismic Toss does a flat 100. Level-30 Pikachu has < 100 max HP.
test.describe('depth-1 search', () => {
  test('a guaranteed KO into a win ranks first with a winning score', () => {
    const root = serialize(makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30)],
    ));
    const result = searchPosition(root, { depth: 1, samples: 1 });
    expect(result.perSide.p1[0].choice).toBe('move seismictoss');
    expect(result.perSide.p1[0].worstCase).toBe(1);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.depthCompleted).toBe(1);
  });

  test('when staying in dies, the saving switch ranks first', () => {
    // p1 active: level-30 Pikachu (dies to the toss); bench: level-100 Blissey
    // (survives it easily). p2: level-100 Machamp, Seismic Toss only.
    const battle = makeBattle(
      [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Blissey', 'Blissey', ['Protect'], 100)],
      [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
    );
    const result = searchPosition(serialize(battle), { depth: 1, samples: 1 });
    expect(result.perSide.p1[0].choice).toBe('switch 2');
  });

  test('worst case, expected, and punishedBy are populated and own-perspective', () => {
    const root = serialize(makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
      [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100)],
    ));
    const result = searchPosition(root, { depth: 1, samples: 1 });
    for (const side of ['p1', 'p2'] as const) {
      expect(result.perSide[side].length).toBeGreaterThan(0);
      for (const ranked of result.perSide[side]) {
        expect(ranked.punishedBy).not.toBeNull();
        expect(ranked.worstCase).toBeLessThanOrEqual(ranked.expected + 1e-9);
      }
    }
  });

  test('progress covers the full matrix and results are deterministic', () => {
    const root = serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
      [makeSet('Chansey', 'Chansey', ['Protect', 'Substitute'])],
    ));
    const progress: SearchProgress[] = [];
    const first = searchPosition(root, { depth: 1, samples: 3 }, { onProgress: p => progress.push(p) });
    const second = searchPosition(root, { depth: 1, samples: 3 });
    expect(first).toEqual(second);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last.done).toBe(last.total);
  });
});

test.describe('iterative deepening', () => {
  // p2 has two level-30 Pokémon, each KO'd by one level-100 Seismic Toss.
  // Depth 1 sees one KO; depth 2 sees the full win and must raise the score.
  const twoTurnWin = () => serialize(makeBattle(
    [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30)],
  ));

  test('depth 2 refines the score above depth 1', () => {
    const depth1 = searchPosition(twoTurnWin(), { depth: 1, samples: 1 });
    const depth2 = searchPosition(twoTurnWin(), { depth: 2, samples: 1 });
    expect(depth2.depthCompleted).toBe(2);
    expect(depth2.score).toBeGreaterThan(depth1.score);
    expect(depth2.perSide.p1[0].choice).toBe('move seismictoss');
  });

  test('one partial result per completed depth, deterministic', () => {
    const partials: EvalResult[] = [];
    const first = searchPosition(twoTurnWin(), { depth: 3, samples: 1 }, { onPartial: r => partials.push(r) });
    expect(partials.map(partial => partial.depthCompleted)).toEqual([1, 2, 3]);
    expect(first.depthCompleted).toBe(3);
    const second = searchPosition(twoTurnWin(), { depth: 3, samples: 1 });
    expect(first).toEqual(second);
  });

  test('shouldStop halts deepening but returns the depth-1 result', () => {
    const result = searchPosition(twoTurnWin(), { depth: 3, samples: 1 }, { shouldStop: () => true });
    expect(result.depthCompleted).toBe(1);
    expect(result.perSide.p1.length).toBeGreaterThan(0);
  });
});
