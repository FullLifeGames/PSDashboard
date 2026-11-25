import { CHAMPIONS_MOD } from '../calc-gen.ts';
import { toId } from '../ids.ts';
import { ppUsedOf } from '../protocol/parser-state.ts';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { twinBattle } from '../sim-ask/twin.ts';
import { clientPokemon } from './client-facts.ts';
import { type InferrerState } from './inferrer-state.ts';

// The simulator's Leppa Berry (Gen 2: Mystery Berry) eats in `onUpdate` once a slot sits at 0 PP and the holder has HP.

const maxByDex = new WeakMap<RulesDex, Map<string, number | null>>();

/** The maximum PP of a move as the simulator builds its slot; null when the twin has no such slot. */
export function maxPpOf(dex: RulesDex, move: string): number | null {
  const info = dex.moves.get(move);
  if (!info.exists) return null;
  const memo = maxByDex.get(dex) ?? new Map<string, number | null>();
  maxByDex.set(dex, memo);
  if (memo.has(info.id)) return memo.get(info.id)!;
  let max: number | null;
  try {
    // The simulator builds every move with three PP Ups (none for `noPPBoosts`) and Champions computes PP its own way.
    const species = dex.species.all().find(entry => entry.gen <= dex.gen && !entry.isNonstandard);
    const body = (moves: string[]) => ({
      name: species!.name, species: species!.name, item: '', ability: '', moves, nature: 'Hardy', gender: '', level: 100,
      evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    });
    const format = `gen${dex.gen}${dex.currentMod === CHAMPIONS_MOD ? 'champions' : ''}customgame`;
    const battle = twinBattle(format, { p1: { name: 'A', team: [body([info.name])] }, p2: { name: 'B', team: [body([info.name])] } });
    max = battle.p1.pokemon[0].moveSlots.find(slot => slot.id === info.id)?.maxpp ?? null;
  } catch {
    max = null;
  }
  memo.set(info.id, max);
  return max;
}

/** Whether the log shows the slot spent to its maximum PP (a lower count proves nothing); a Transform reads nothing. */
export function spentToMax(state: InferrerState, ident: string, move: string): boolean {
  const mon = clientPokemon(state, ident);
  if (!mon || mon.volatiles.transform) return false;
  const used = Object.entries(ppUsedOf(mon) ?? {}).find(([name]) => toId(name) === toId(move))?.[1];
  if (used === undefined) return false;
  const max = maxPpOf(dexOf(state), move);
  return max !== null && (typeof used === 'number' ? used : used[0]) >= max;
}
