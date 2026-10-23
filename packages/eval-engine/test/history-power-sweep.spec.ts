import { describe, expect, test } from 'vitest';
import { Dex, State } from '@pkmn/sim';
import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
import { CHAMPIONS_MOD, calcGenerationFor, historyPower } from '@fulllifegames/replay-core';
import { bodyOf } from '../src/calc/body';
import { calcMove } from '../src/calc/move';
import { landedMove } from '../src/score/move-facts';
import { cloneBattle } from '../src/forward/sim-fast/clone';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 76 (T265): a move whose `basePowerCallback` reads the battle's history (the fallen of the user's side, the hits the user
 * took: Last Respects and Rage Fist in today's Dex) is priced at the power the simulator's own callback gives on those facts by
 * every path that prices a move: the calculator's move (calc/move.ts, which the kill table and the KO odds read) and the static
 * (score/move-facts.ts). The moves are found by `historyPower` of replay-core, the one rule that classifies them, in every
 * generation and mod the corpus plays, singles and doubles. The scene: an Annihilape that took two hits plays Rage Fist at 150
 * in the game; the calculator read 50 (it counts no hits) and the static read the handler's placeholder.
 */

await loadSimMods('gen9championsou');

const FORMATS = [3, 4, 5, 6, 7, 8, 9].flatMap(gen => [`gen${gen}customgame`, `gen${gen}doublescustomgame`])
  .concat('gen9championscustomgame', 'gen9championsdoublescustomgame');
/** [fallen of the user's side, hits the user took] */
const FACTS: [number, number][] = [[0, 0], [2, 0], [0, 2], [3, 5], [1, 9], [5, 12]];

const tally = { moves: new Set<string>(), checked: 0 };

describe('the history power moves: the simulator\'s callback, the calculator\'s move and the static agree on the same facts (round 76, T265)', () => {
  for (const format of FORMATS) {
    test(format, () => {
      const dex = Dex.forFormat(format);
      if (!dex.formats.get(format).exists) return;
      const doubles = format.includes('doubles');
      const mod = format.includes('champions') ? CHAMPIONS_MOD : undefined;
      const gen = calcGenerationFor(dex.gen, mod);
      const ids = dex.moves.all().filter(move => historyPower(dex, move.id, { fainted: 0, timesAttacked: 0 }) !== null).map(move => move.id);
      expect(ids.length, format).toBeGreaterThan(0);
      const battle = battleOf(format,
        [set('Machamp', ['splash']), ...(doubles ? [set('Corviknight', ['splash'])] : []), set('Snorlax', ['splash'])],
        [set('Snorlax', ['splash']), ...(doubles ? [set('Blissey', ['splash'])] : []), set('Machamp', ['splash'])]);
      const [attacker, defender] = [battle.sides[0].active[0] as Pokemon, battle.sides[1].active[0] as Pokemon];
      for (const id of ids) {
        const move = battle.dex.moves.get(id);
        for (const [fainted, hits] of FACTS) {
          battle.sides[0].totalFainted = fainted;
          attacker.timesAttacked = hits;
          const label = `${format} ${id} fainted ${fainted} hits ${hits}`;
          const want = (move.basePowerCallback as unknown as (this: Battle, ...args: unknown[]) => number).call(battle, attacker, defender, move as unknown as ActiveMove);
          expect(typeof want, label).toBe('number');
          expect(calcMove(gen, move.name, bodyOf(battle, attacker)).bp, `calc ${label}`).toBe(want);
          expect(landedMove(attacker, defender, move, battle).basePower, `static ${label}`).toBe(want);
          tally.checked++;
        }
        tally.moves.add(id);
      }
    });
  }

  test('both moves of today\'s Dex are in the sweep', () => {
    expect([...tally.moves].sort()).toEqual(['lastrespects', 'ragefist']);
    expect(tally.checked).toBeGreaterThan(0);
  });

  test('the facts survive the copies a tree makes: the state round trip of the simulator and the clone of the speed layer', () => {
    for (const format of ['gen9customgame', 'gen9doublescustomgame']) {
      const battle = battleOf(format, [set('Annihilape', ['ragefist']), set('Snorlax', ['splash'])], [set('Snorlax', ['splash']), set('Machamp', ['splash'])]);
      battle.sides[0].active[0].timesAttacked = 4;
      battle.sides[0].totalFainted = 1;
      const copies = [State.deserializeBattle(State.serializeBattle(battle) as never), cloneBattle(battle)];
      for (const copy of copies) {
        const [attacker, defender] = [copy.sides[0].active[0], copy.sides[1].active[0]];
        expect(attacker.timesAttacked, format).toBe(4);
        expect(landedMove(attacker, defender, copy.dex.moves.get('ragefist'), copy).basePower, format).toBe(250);
      }
    }
  });
});
