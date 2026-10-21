import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { historyPower, historyPowerMove } from '../src/spreads/hit-power';

/**
 * Round 73 (T210, group 1): the sweep over every move of the Dex with a `basePowerCallback`, in every generation and mod the
 * corpus plays, sorted by what the callback reads on a recording stand-in. The history class (the fallen of the user's side, the
 * hits the user took) is what the solver prices; its members are held against the simulator's own callback on a real battle at
 * sampled counts. A new Dex move that reads only the history joins the class and fails the list below until it is named. The other
 * classes are the findings: moves whose power reads state the observation does not carry (listed in the ledger as new TODO proposals).
 */

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const dexes = [5, 6, 7, 8, 9].map(gen => [`gen ${gen}`, Dex.forGen(gen)] as const).concat([['champions', Dex.mod('champions')] as never]);

const callbackMoves = (dex: ReturnType<typeof Dex.forGen>) => dex.moves.all().filter(move => typeof (move as { basePowerCallback?: unknown }).basePowerCallback === 'function');

describe('the history class of base power callbacks', () => {
  test.each(dexes)('%s: exactly the moves whose callback reads the fallen or the hits taken', (_name, dex) => {
    const moves = callbackMoves(dex);
    expect(moves.length).toBeGreaterThan(20);
    const history = moves.filter(move => historyPowerMove(dex as never, move.id)).map(move => move.id).sort();
    // Every Dex keeps the data of the later generations' moves (flagged non-standard), so every one lists both.
    expect(history).toEqual(['lastrespects', 'ragefist']);
    for (const move of moves) {
      if (!history.includes(move.id)) expect(historyPower(dex as never, move.id, { fainted: 3, timesAttacked: 2 }), move.id).toBeNull();
    }
  });
});

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', gender: '', level: 100,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

describe('the solver\'s power is the simulator\'s callback on a real battle', () => {
  const battle = new Battle({
    formatid: toID('gen9customgame') as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([set('Basculegion', ['Last Respects', 'Rage Fist'])]) },
    p2: { name: 'Beta', team: Teams.pack([set('Blissey', ['Splash'])]) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  const [mine, foe] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];

  const counts = [0, 1, 2, 3, 5, 6, 9];
  for (const move of ['lastrespects', 'ragefist']) {
    test.each(counts)(`${move} at %i`, count => {
      mine.side.totalFainted = count;
      mine.timesAttacked = count;
      const active = battle.dex.getActiveMove(move);
      const power = (active as unknown as { basePowerCallback: (this: Battle, pokemon: typeof mine, target: typeof foe, move: typeof active) => number }).basePowerCallback.call(battle, mine, foe, active);
      expect(historyPower(Dex.forGen(9), move, { fainted: count, timesAttacked: count })).toBe(power);
    });
  }
});
