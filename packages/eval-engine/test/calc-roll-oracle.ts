import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { createRootPosition, type SimPosition } from '../src/forward-model';
import { drawPair, type PairDraw } from '../src/pair/draw';
import { killTable, rollValue, type KillTable } from '../src/pair/kill-table';
import { hpAfterHit } from '../src/pair/log';
import type { RollRecord } from '../src/pair/prng';

/**
 * Round 67, lane A test helpers: the calc against the simulator at the drawn
 * roll. A turn is drawn under the recording dice (pair/draw.ts); every hit's
 * kill table, priced from the snapshot the dice took, must hold the damage
 * the log shows (at least the HP on a kill), as pair-kill-table.spec.ts
 * checks it. A singles hit runs through the same table: its doubles field
 * differs from the singles one only by screens, and these battles have none.
 */

const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function rollSet(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { ...STATS, hp: 252, atk: 252, spa: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '', ...extra,
  };
}

/** A custom game past team preview (every set in team order); `setup` may change the battle before it is serialized. */
export function rootOf(format: 'gen9customgame' | 'gen9doublescustomgame' | 'gen7customgame' | 'gen7doublescustomgame' | 'gen6customgame' | 'gen3customgame',
  p1: PokemonSet[], p2: PokemonSet[], setup?: (battle: Battle) => void): SimPosition {
  const battle = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  setup?.(battle);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

export interface CheckedRoll { roll: RollRecord; table: KillTable | null; holds: boolean }

const targetOf = (key: string) => key.slice(key.indexOf('>') + 1);

export function drawTurn(root: SimPosition, p1: string, p2: string, seed = '1,2,3,4'): PairDraw {
  return drawPair(root, p1, p2, seed as never, new Map(), createMatchupCache());
}

/** Every recorded hit of a drawn turn with its kill table and whether the table holds the logged damage. */
export function checkedRolls(drawn: PairDraw): CheckedRoll[] {
  return drawn.records.filter((record): record is RollRecord => record.kind === 'roll').flatMap(roll => {
    const after = hpAfterHit(drawn.log, roll.logIndex, targetOf(roll.key), roll.snapshot.defender.maxhp);
    if (after === null) return [];
    const table = killTable(roll.snapshot);
    const before = roll.snapshot.defender.hp;
    const value = table && rollValue(table, roll.roll, roll.crit);
    const holds = value !== null && (after === 0 ? value >= before : value === before - after);
    return [{ roll, table, holds }];
  });
}
