import { describe, expect, test } from 'vitest';
import { randomCallMoves } from '../src/ko-odds';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

const real = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future';
};

const callers = (view: SimView): string[] => view.dex.moves.all()
  .filter(move => real(view, move.id) && (move as unknown as { callsMove?: boolean }).callsMove).map(move => move.id);

function calls(view: SimView, id: string): boolean {
  const name = view.dex.moves.get(id).name;
  const { target, sleepUsable } = view.dex.moves.get(id);
  // Generations 1 to 3 write "[from] Name", later ones "[from] move: Name".
  const called = new RegExp(String.raw`\[from\](?: move:)? ?${name}(?:\||$)`);
  const aimed = ['normal', 'any', 'adjacentFoe'].includes(target);
  for (const [[user, foe], seed] of [['Blissey', 'Snorlax'], ['Snorlax', 'Blissey']].flatMap(pair => ['1,2,3,4', '5,6,7,8', '9,10,11,12'].map(seed => [pair, seed] as const))) {
    const battle = battleIn(view, [mon(user, [id, 'harden']), mon('Blissey', ['tackle']), mon('Blissey', ['tackle'])], [mon(foe, ['tackle']), mon(foe, ['tackle']), mon(foe, ['tackle'])], seed);
    if (sleepUsable) battle.sides[0].active[0].setStatus('slp');
    battle.choose('p1', view.doubles ? `move 1${aimed ? ' 1' : ''}, move 1 1` : 'move 1');
    battle.choose('p2', view.doubles ? 'move 1 1, move 1 1' : 'move 1');
    if (battle.log.some(line => line.startsWith('|move|') && called.test(line))) return true;
  }
  return false;
}

describe('randomCallMoves is held to the simulator', () => {
  test('the sets are every move the Dex marks callsMove, over all views', () => {
    const marked = [...new Set(ALL_VIEWS.flatMap(callers))].sort();
    expect([...new Set(ALL_VIEWS.flatMap(view => [...randomCallMoves(view.dex)]))].sort()).toEqual(marked);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    test('each call move of the view is in the set', () => {
      if (view.dex.gen >= 2) expect(callers(view).length).toBeGreaterThan(0);
      expect(callers(view).filter(id => !randomCallMoves(view.dex).has(id))).toEqual([]);
    });

    test('each call move of the view calls a move in the simulator', () => {
      expect(callers(view).filter(id => !calls(view, id))).toEqual([]);
    });
  });
});
