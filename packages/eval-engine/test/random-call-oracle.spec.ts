import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { RANDOM_CALL_MOVES } from '../src/ko-odds';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 6, FINDING W1: `RANDOM_CALL_MOVES` in ko-odds.ts (read by search/leaf.ts and cell-blend.ts, and by
 * pair/guards.ts through the same export) holds the moves whose result depends on a move chosen elsewhere, so the one-turn
 * model refuses to price them. The Dex marks them with `callsMove`: seven moves, where the hand list named four (Sleep Talk,
 * Metronome, Assist, Copycat) and missed Mirror Move, Me First and Nature Power (Past in Generation 9, live in Generations 3 to 7).
 * In every view the corpus plays:
 *  - the moves the Dex marks `callsMove`, over all views, are the set (derived from the Dex, no hand list);
 *  - each of them is played, and the simulator writes a `|move|` line "[from] move: <its name>" for the move it called;
 *  - pair/guards.ts keeps no copy of the set.
 * A move the Dex flags `sleepUsable` (Sleep Talk) is played asleep, the user carries no Tackle (Generation 2 Mirror Move refuses a move the user knows), Mirror Move and Copycat behind a faster foe, Me First ahead of one, Assist with a bench mate.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));

const real = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future';
};

const callers = (view: SimView): string[] => view.dex.moves.all()
  .filter(move => real(view, move.id) && (move as unknown as { callsMove?: boolean }).callsMove).map(move => move.id);

/** Whether a turn of the move, with the user ahead of or behind the foe (three seeds), writes the line of a move it called. */
function calls(view: SimView, id: string): boolean {
  const name = view.dex.moves.get(id).name;
  const { target, sleepUsable } = view.dex.moves.get(id);
  const called = new RegExp(String.raw`\[from\](?: move:)? ?${name}(?:\||$)`); // Generations 1 to 3 write "[from] Name", later ones "[from] move: Name"
  const aimed = ['normal', 'any', 'adjacentFoe'].includes(target);
  // Several seeds: a Tackle that misses leaves Mirror Move nothing to copy in the older generations.
  for (const [[user, foe], seed] of [['Blissey', 'Snorlax'], ['Snorlax', 'Blissey']].flatMap(pair => ['1,2,3,4', '5,6,7,8', '9,10,11,12'].map(seed => [pair, seed] as const))) {
    const battle = battleIn(view, [mon(user, [id, 'harden']), mon('Blissey', ['tackle']), mon('Blissey', ['tackle'])], [mon(foe, ['tackle']), mon(foe, ['tackle']), mon(foe, ['tackle'])], seed);
    if (sleepUsable) battle.sides[0].active[0].setStatus('slp');
    battle.choose('p1', view.doubles ? `move 1${aimed ? ' 1' : ''}, move 1 1` : 'move 1');
    battle.choose('p2', view.doubles ? 'move 1 1, move 1 1' : 'move 1');
    if (battle.log.some(line => line.startsWith('|move|') && called.test(line))) return true;
  }
  return false;
}

describe('RANDOM_CALL_MOVES is held to the simulator (round 72)', () => {
  test('the set is every move the Dex marks callsMove, over all views', () => {
    const marked = [...new Set(ALL_VIEWS.flatMap(callers))].sort();
    expect([...RANDOM_CALL_MOVES].sort()).toEqual(marked);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    test('each call move of the view is in the set', () => {
      if (view.dex.gen >= 2) expect(callers(view).length).toBeGreaterThan(0);
      expect(callers(view).filter(id => !RANDOM_CALL_MOVES.has(id))).toEqual([]);
    });

    test('each call move of the view calls a move in the simulator', () => {
      expect(callers(view).filter(id => !calls(view, id))).toEqual([]);
    });
  });

  test('pair/guards.ts reads the one set and keeps no copy', () => {
    const source = readFileSync(resolve(root, 'packages/eval-engine/src/pair/guards.ts'), 'utf8');
    expect(/RANDOM_CALL_MOVES\s*=\s*new Set/.test(source)).toBe(false);
    expect(/import\s*\{[^}]*RANDOM_CALL_MOVES[^}]*\}\s*from\s*'\.\.\/ko-odds\.ts'/.test(source)).toBe(true);
  });
});
