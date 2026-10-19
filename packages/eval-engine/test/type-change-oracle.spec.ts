import { describe, expect, test } from 'vitest';
import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
import { CONTEXT_MOVES, NO_ATE, NO_NORMALIZE, RULE_MOVES, moveAtUse, type MoveLike } from '../src/move-use';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan rows 11 and 12: move-use.ts keeps three lists of move ids by hand, because it imports nothing (the
 * app's main bundle reads it): the moves the -ate abilities leave alone (NO_ATE), the moves Normalize leaves alone (NO_NORMALIZE)
 * and the moves whose type or power reads a fact the matchup memo's key does not carry (CONTEXT_MOVES). The simulator is the
 * oracle for all three, in every view the corpus plays:
 *  - the resolved type of every move of the view, played through the four events `useMoveInner` runs (ModifyType and ModifyMove
 *    as the move's own handler and as the user's), with and without the ability. A Normal move the -ate ability leaves Normal
 *    is the exempt set; the moves Normalize leaves as they were are its set (Generation 7 on; before it only Struggle stays);
 *  - the handler text of the abilities, which names the same ids in `noModifyType`;
 *  - the 13 moves of the Dex that carry an `onModifyType` handler are all either a context move or a rule move of move-use.ts,
 *    and each context move changes its type when its context changes (weather, terrain, the Hidden Power IVs, Tera).
 */

const ATE = ['pixilate', 'aerilate', 'refrigerate', 'galvanize', 'dragonize'];
const spec = 'packages/eval-engine/test/type-change-oracle.spec.ts';

const isReal = (view: SimView, kind: 'moves' | 'abilities', id: string): boolean => {
  const entry = view.dex[kind].get(id);
  return entry.exists && entry.isNonstandard !== 'Future';
};
/** Every move of the view once by id (the Dex lists Hidden Power once per type, all under one id). */
const realMoves = (view: SimView) => {
  const seen = new Set<string>();
  return view.dex.moves.all().filter(move => isReal(view, 'moves', move.id) && !move.isMax && !move.isZ && !seen.has(move.id) && !!seen.add(move.id));
};

/** The type `useMoveInner` leaves on the move: the four type and move events, as it runs them. */
function resolvedType(battle: Battle, user: Pokemon, target: Pokemon, moveId: string): string {
  let move = battle.dex.getActiveMove(moveId) as ActiveMove;
  battle.setActiveMove(move, user, target);
  battle.singleEvent('ModifyType', move, null, user, target, move, move);
  battle.singleEvent('ModifyMove', move, null, user, target, move, move);
  move = battle.runEvent('ModifyType', user, target, move, move) as ActiveMove;
  move = battle.runEvent('ModifyMove', user, target, move, move) as ActiveMove;
  return move.type;
}

/** A Blissey (Normal) or another `species` with `ability` against a Snorlax, as the first of two in every view. */
function users(view: SimView, ability: string, species = 'Blissey') {
  const battle = battleIn(view, [mon(species, ['splash'], { ability }), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  return { battle, user: battle.sides[0].active[0], target: battle.sides[1].active[0] };
}

const idsInHandler = (ability: { onModifyType?: unknown }): string[] => {
  const text = String(ability.onModifyType);
  const list = /noModifyType\s*=\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '';
  return [...list.matchAll(/'([a-z0-9]+)'/g)].map(match => match[1]).sort();
};

describe('the type lists of move-use.ts are held to the simulator (round 72)', () => {
  test('the lists carry their oracle tag', () => {
    for (const name of ['const NO_ATE', 'const NO_NORMALIZE', 'const CONTEXT_MOVES']) {
      expect(oracleTagAbove('packages/eval-engine/src/move-use.ts', name, spec), name).toBe(true);
    }
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const gen = view.dex.gen;
    const moves = realMoves(view);

    test.each(ATE.filter(ability => isReal(view, 'abilities', ability)))('%s leaves Normal only the NO_ATE moves Normal', ability => {
      const own = users(view, 'noability');
      const boosted = users(view, ability);
      const exempt = moves
        .filter(move => resolvedType(own.battle, own.user, own.target, move.id) === 'Normal' && resolvedType(boosted.battle, boosted.user, boosted.target, move.id) === 'Normal')
        .map(move => move.id)
        .sort();
      expect(exempt).toEqual([...NO_ATE].filter(id => isReal(view, 'moves', id)).sort());
      expect(idsInHandler(view.dex.abilities.get(ability))).toEqual([...NO_ATE].sort());
    });

    test.skipIf(!isReal(view, 'abilities', 'normalize'))('Normalize turns every move Normal but the ones move-use.ts names', () => {
      const own = users(view, 'noability');
      const normal = users(view, 'normalize');
      const stays = moves
        .filter(move => {
          const before = resolvedType(own.battle, own.user, own.target, move.id);
          return before !== 'Normal' && resolvedType(normal.battle, normal.user, normal.target, move.id) === before;
        })
        .map(move => move.id)
        .sort();
      // Generations 3 and 4 turn everything but Struggle Normal (onModifyMove); Generations 5 and 6 turn every move whose Dex type is
      // not Normal (Hidden Power keeps its IV type: FINDING W7, the sweep above holds move-use.ts to it); from 7 the noModifyType list stays.
      const named = gen >= 7 ? [...NO_NORMALIZE] : gen >= 5 ? ['struggle', 'hiddenpower'] : ['struggle'];
      const expected = named.filter(id => isReal(view, 'moves', id) && resolvedType(own.battle, own.user, own.target, id) !== 'Normal').sort();
      expect(stays).toEqual(expected);
      if (gen >= 7) expect(idsInHandler(view.dex.abilities.get('normalize'))).toEqual([...NO_NORMALIZE].sort());
    });

    test.skipIf(!isReal(view, 'abilities', 'normalize'))('moveAtUse gives a Normalize user the type the simulator leaves on every move (Hidden Power set to Fire)', () => {
      const { battle, user, target } = users(view, 'normalize');
      user.hpType = 'Fire';
      const wrong = moves.filter(move => {
        const answer = moveAtUse(view.dex.moves.get(move.id) as unknown as MoveLike, { gen, abilities: ['normalize'], hpType: 'Fire', types: user.getTypes() });
        return answer !== null && answer.type !== resolvedType(battle, user, target, move.id);
      }).map(move => move.id);
      expect(wrong).toEqual([]);
    });

    test('every move with an onModifyType handler is a context move or a rule move, and no context move is stale', () => {
      const withHandler = moves.filter(move => (move as unknown as { onModifyType?: unknown }).onModifyType).map(move => move.id);
      if (gen >= 4) expect(withHandler.length).toBeGreaterThan(0); // Generations 1 to 3 hold the move names only as Future entries
      expect(withHandler.filter(id => !CONTEXT_MOVES.has(id) && !RULE_MOVES.has(id))).toEqual([]);
      for (const id of CONTEXT_MOVES) if (isReal(view, 'moves', id)) expect(withHandler, id).toContain(id);
    });

    test('a context move changes its type when its context changes', () => {
      const changes = (id: string, prepare: (battle: Battle, user: Pokemon) => void): boolean => {
        const plain = users(view, 'noability');
        const after = users(view, 'noability');
        prepare(after.battle, after.user);
        return resolvedType(plain.battle, plain.user, plain.target, id) !== resolvedType(after.battle, after.user, after.target, id);
      };
      const asked: string[] = [];
      const ask = (id: string, ok: boolean) => { if (isReal(view, 'moves', id)) { asked.push(id); expect(ok, id).toBe(true); } };
      ask('weatherball', changes('weatherball', (battle, user) => { battle.field.setWeather('sunnyday', user); }));
      ask('terrainpulse', changes('terrainpulse', (battle, user) => { battle.field.setTerrain('electricterrain', user); }));
      ask('hiddenpower', changes('hiddenpower', (_battle, user) => { user.hpType = 'Fighting'; }));
      if (gen === 9) ask('terablast', changes('terablast', (_battle, user) => { user.teraType = 'Fire'; user.terastallized = 'Fire'; }));
      // Tera Starstorm turns Stellar for the Stellar forme of Terapagos only: the species, not the Tera click, is its context.
      if (isReal(view, 'moves', 'terastarstorm') && view.dex.species.get('Terapagos-Stellar').exists) {
        const forme = users(view, 'noability', 'Terapagos-Stellar');
        const base = users(view, 'noability', 'Terapagos');
        ask('terastarstorm', resolvedType(forme.battle, forme.user, forme.target, 'terastarstorm') !== resolvedType(base.battle, base.user, base.target, 'terastarstorm'));
      }
      if (gen >= 4) expect(asked.length).toBeGreaterThan(0);
    });
  });
});
