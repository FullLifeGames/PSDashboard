import { describe, expect, test } from 'vitest';
import { playedSetupMove } from '../src/analysis';
import { CODED_SETUP_MOVES, fieldStages } from '../src/dex-facts/setup';
import { setupMoveClicked, setupMovesOf } from '../src/turn-analysis/played-match';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';


const NOT_SETUP = ['acupressure', 'metronome'];

const real = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future' && !move.isMax && !move.isZ;
};

function stagesGained(view: SimView, id: string): number | null {
  const move = view.dex.moves.get(id);
  if (move.target === 'adjacentAlly') return null; // needs a partner target: it boosts the partner, not its user
  const loc = move.target === 'adjacentAllyOrSelf' ? ' -1' : ['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : '';
  const battle = battleIn(view,
    [mon('Blissey', [id, 'splash']), mon('Blissey', ['splash']), mon('Blissey', ['splash'])],
    [mon('Snorlax', ['splash']), mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  const user = battle.sides[0].active[0];
  for (let turn = 0; turn < ((move.flags as Record<string, unknown>).charge ? 2 : 1); turn++) {
    battle.choose('p1', view.doubles ? `move 1${loc}, move 1` : 'move 1');
    battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  }
  return Object.entries(user.boosts as Record<string, number>).filter(([stat, stage]) => stage > 0 && stat !== 'evasion').reduce((sum, [, stage]) => sum + stage, 0);
}

const found = new Map<string, string[]>();
function setupMovesIn(view: SimView): string[] {
  let here = found.get(view.name);
  if (!here) {
    here = view.dex.moves.all().filter(move => real(view, move.id) && move.category === 'Status' && (stagesGained(view, move.id) ?? 0) >= 2).map(move => move.id);
    found.set(view.name, here);
  }
  return here;
}

describe('The setup moves are held to the simulator', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    test('every setup move the simulator shows here is in the set', () => {
      expect(setupMovesIn(view).filter(id => !NOT_SETUP.includes(id) && !setupMovesOf(view.dex).has(id))).toEqual([]);
    });

    test('every id in the set that the view plays is a setup move here, or one the view builds differently', () => {
      // Gens 2 to 4 give Growth one stage, and Gen 3 gives Stockpile none (the boosts come in Gen 4); the doubles
      // sweep cannot aim Curse (it needs a target in the request).
      const unlike = [...(view.dex.gen >= 2 && view.dex.gen <= 4 ? ['growth'] : []), ...(view.dex.gen === 3 ? ['stockpile'] : []), ...(view.doubles ? ['curse'] : [])];
      expect([...setupMovesOf(view.dex)].filter(id => real(view, id) && !setupMovesIn(view).includes(id) && !unlike.includes(id))).toEqual([]);
    });
  });

  test('the sets are exactly the union over the views, minus the two random moves', () => {
    const union = [...new Set(ALL_VIEWS.flatMap(setupMovesIn))].filter(id => !NOT_SETUP.includes(id)).sort();
    expect([...new Set(ALL_VIEWS.flatMap(view => [...setupMovesOf(view.dex)]))].sort()).toEqual(union);
  });

  test('the handler moves are the ones no data field covers, and the list carries its oracle tag', () => {
    const spec = 'packages/eval-engine/test/setup-moves-oracle.spec.ts';
    expect(oracleTagAbove('packages/eval-engine/src/dex-facts/setup.ts', 'export const CODED_SETUP_MOVES', spec)).toBe(true);
    for (const view of ALL_VIEWS) for (const id of CODED_SETUP_MOVES.filter(name => real(view, name))) {
      expect(fieldStages(view.dex.moves.get(id) as Parameters<typeof fieldStages>[0]), `${id} in ${view.name}`).toBeLessThan(2);
    }
    for (const view of ALL_VIEWS) {
      const byField = [...setupMovesOf(view.dex)].filter(id => !CODED_SETUP_MOVES.includes(id));
      expect(byField.filter(id => fieldStages(view.dex.moves.get(id) as Parameters<typeof fieldStages>[0]) < 2), view.name).toEqual([]);
    }
  });

  test('the record names Shelter, Take Heart and Tidy Up, and a plain attack stays null', () => {
    const side = (name: string) => ({ playedRaw: { kind: 'move', name } }) as unknown as Parameters<typeof setupMoveClicked>[0];
    const dex = ALL_VIEWS[8].dex;
    for (const name of ['Shelter', 'Take Heart', 'Tidy Up', 'Swords Dance']) expect(setupMoveClicked(side(name), dex)).toBe(name);
    expect(setupMoveClicked(side('Tackle'), dex)).toBeNull();
    expect(playedSetupMove({ setupMove: 'Swords Dance' })).toBe('Swords Dance');
    expect(playedSetupMove({})).toBeNull();
  });
});
