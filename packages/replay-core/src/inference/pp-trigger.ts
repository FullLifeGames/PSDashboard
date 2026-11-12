import { CHAMPIONS_MOD } from '../calc-gen.ts';
import { toId } from '../ids.ts';
import { ppUsedOf } from '../protocol/parser-state.ts';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { twinBattle } from '../sim-ask/twin.ts';
import { clientPokemon } from './client-facts.ts';
import { type InferrerState } from './inferrer-state.ts';

/**
 * Round 89 (#132): the PP half of the Leppa Berry rule (item-triggers.ts reads it as its fifth rule). A Pokémon that has spent a
 * move's last PP and shows no item line held no berry that eats at 0 PP: the simulator's Leppa Berry (and, in Generation 2, the
 * Mystery Berry) eats in `onUpdate` the moment a slot sits at 0 PP and the holder has HP. Two readings live here, both from the
 * simulator and neither from Dex base values:
 *  - which items eat at 0 PP: `ppEaters` in item-triggers.ts, which owns the stand-in holder (sim-ask-callers.spec.ts names that file
 *    as the module that calls Dex handlers on a stand-in);
 *  - `maxPpOf`: the maximum PP of a move, the `maxpp` of its slot on a twin battle of the replay's format. The simulator builds
 *    every move with three PP Ups (none for a move with `noPPBoosts`) and Champions computes PP its own way, so no formula is typed.
 * `spentToMax` joins them with the client's count of the PP the log shows spent: a count that reaches the maximum proves the slot
 * at 0 PP (a player with fewer PP Ups reaches 0 earlier, a lower count proves nothing).
 * pp-trigger-sweep.spec.ts holds both to the simulator in every generation and mod, singles and doubles.
 */

const maxByDex = new WeakMap<RulesDex, Map<string, number | null>>();

/** The maximum PP of a move as the simulator builds its slot (three PP Ups, the mod's own rule), asked once per Dex and move; null when the twin has no such slot. */
export function maxPpOf(dex: RulesDex, move: string): number | null {
  const info = dex.moves.get(move);
  if (!info.exists) return null;
  const memo = maxByDex.get(dex) ?? new Map<string, number | null>();
  maxByDex.set(dex, memo);
  if (memo.has(info.id)) return memo.get(info.id)!;
  let max: number | null;
  try {
    // The twin needs a body of the generation, not a particular one: the first species the Dex holds there.
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

/**
 * Whether the log shows the holder's slot of this move spent to its maximum PP: the least PP the client counts (a range when Pressure
 * is open or a charge move may have spent once) reaches the maximum. The client's body is the one the walk reads; a transformed holder
 * reads nothing, as its slots count no PP of their own (the client books the copies to the target at 0 PP, the simulator's copied
 * slots hold at most 5 PP).
 */
export function spentToMax(state: InferrerState, ident: string, move: string): boolean {
  const mon = clientPokemon(state, ident);
  if (!mon || mon.volatiles.transform) return false;
  const used = Object.entries(ppUsedOf(mon) ?? {}).find(([name]) => toId(name) === toId(move))?.[1];
  if (used === undefined) return false;
  const max = maxPpOf(dexOf(state), move);
  return max !== null && (typeof used === 'number' ? used : used[0]) >= max;
}
