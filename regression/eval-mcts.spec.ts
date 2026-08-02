import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeTurn, matchPlayedChoice } from '../src/lib/eval/analysis';
import { mctsSearch, MCTS_ITERATIONS } from '../src/lib/eval/mcts';
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
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

const threeTurnWin = () => serialize(makeBattle(
  [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
  [
    makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
    makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
    makeSet('Vulpix', 'Vulpix', ['Tackle', 'Growl'], 30),
  ],
));

test.describe('DUCT-MCTS search', () => {
  test('finds the winning line and prefers it', () => {
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.perSide.p1[0].choice).toBe('move seismictoss');
    expect(result.score).toBeGreaterThan(0.3);
    // The tree reached beyond one turn.
    expect(result.depthCompleted).toBeGreaterThan(1);
  });

  test('sees deeper than the static depth-1 matrix', () => {
    const matrix = searchPosition(threeTurnWin(), { depth: 1, samples: 1, tera: false });
    const mcts = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(mcts.score).toBeGreaterThan(matrix.score);
  });

  test('is deterministic and reports progress', () => {
    const progress: SearchProgress[] = [];
    const partials: EvalResult[] = [];
    const first = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' }, {
      onProgress: p => progress.push(p),
      onPartial: r => partials.push(r),
    });
    const second = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(first).toEqual(second);
    expect(progress[progress.length - 1].done).toBe(MCTS_ITERATIONS);
    expect(partials.length).toBeGreaterThan(0);
  });

  test('feeds the played-vs-best turn analysis (graph sweeps in MCTS mode)', () => {
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    // Even a clearly bad option gets visits (unvisited-first UCB), so a
    // sweep's played-action matching works on visit-ranked results too.
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Protect', tera: false })?.choice).toBe('move protect');
    const analysis = analyzeTurn({
      turn: 1,
      result,
      played: {
        p1: { kind: 'move', name: 'Protect', tera: false },
        p2: { kind: 'move', name: 'Tackle', tera: false },
      },
      playedOutcome: result.score - 0.1,
      scoreBefore: result.score,
      scoreAfter: result.score - 0.15,
    });
    expect(analysis.p1.best?.choice).toBe('move seismictoss');
    expect(analysis.p1.played?.label).toBe('Protect');
    expect(analysis.p2.played?.choice).toBe('move tackle');
    expect(analysis.p1.regret).toBeGreaterThan(0);
  });

  test('runs on a doubles position over restricted combined choices', () => {
    const battle = new Battle({
      formatid: toID('gen9doublescustomgame'),
      seed: '1,2,3,4',
      p1: {
        name: 'Alpha',
        team: Teams.pack([
          makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
          makeSet('Snorlax', 'Snorlax', ['Tackle', 'Protect']),
        ]),
      },
      p2: {
        name: 'Beta',
        team: Teams.pack([
          makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
          makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
        ]),
      },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    const root = serialize(battle);
    const result = mctsSearch(root, { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.perSide.p1.length).toBeGreaterThan(0);
    expect(result.perSide.p1.length).toBeLessThanOrEqual(12);
    expect(result.perSide.p1[0].choice).toContain(','); // combined two-slot choice
    expect(mctsSearch(root, { depth: 1, samples: 1, tera: false, mode: 'mcts' })).toEqual(result);
  });

  test('an ended position returns its exact value', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', ['Protect'])],
      [makeSet('B', 'Chansey', ['Protect'])],
    );
    battle.win(battle.sides[0]);
    const result = mctsSearch(serialize(battle), { depth: 1, samples: 1, mode: 'mcts' });
    expect(result.score).toBe(1);
    expect(result.perSide.p1).toHaveLength(0);
  });
});
