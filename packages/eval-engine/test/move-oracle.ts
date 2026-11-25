import { Battle, Teams, toID } from '@pkmn/sim';
import type { Pokemon, PokemonSet } from '@pkmn/sim';
import type { MoveAtUse } from '../src/move-use';

// Follows battle-actions.js useMoveInner.
// Exact for active bodies only: on the bench the sim switches abilities and items off.
const MODIFY_MOVE_ALLOW = new Set(['weatherball', 'terrainpulse', 'terablast', 'terastarstorm', 'hiddenpower']);

export function set(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '', ...extra,
  };
}

export function singles(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(format),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

export function clickTera(battle: Battle, side: 0 | 1) {
  battle.choose(side === 0 ? 'p1' : 'p2', 'move 1 terastallize');
  battle.choose(side === 0 ? 'p2' : 'p1', 'move 1');
}

export const active = (battle: Battle, side: 0 | 1): Pokemon => battle.sides[side].active[0];
export const bench = (battle: Battle, side: 0 | 1, index: number): Pokemon => battle.sides[side].pokemon[index];

// The -ate / Normalize boost the BasePower event applies (sim abilities.js and mods/gen6).
function boostOf(gen: number, ability: string): number {
  if (ability === 'normalize') return gen >= 7 ? 4915 / 4096 : 1;
  return gen === 6 ? 5325 / 4096 : 4915 / 4096;
}

export function simUse(battle: Battle, attacker: Pokemon, defender: Pokemon, id: string): MoveAtUse {
  const move = battle.dex.getActiveMove(id);
  battle.singleEvent('ModifyType', move, null, attacker, defender, move, move);
  if (MODIFY_MOVE_ALLOW.has(move.id)) battle.singleEvent('ModifyMove', move, null, attacker, defender, move, move);
  battle.runEvent('ModifyType', attacker, defender, move, move);
  const callback = move.basePowerCallback as ((this: Battle, ...args: unknown[]) => number) | undefined;
  const basePower = callback ? callback.call(battle, attacker, defender, move) : move.basePower;
  return {
    type: move.type, category: move.category, basePower,
    powerMult: move.typeChangerBoosted ? boostOf(battle.gen, String(attacker.ability)) : 1,
  };
}
