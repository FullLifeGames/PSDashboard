import type { Battle, Pokemon } from '@pkmn/sim';
import { NO_COST, type HitCost, type StatusCost } from './contact-cost.ts';
import { playHit } from './contact-play.ts';
import { factsOf, mayCost, moveOf } from './contact-filter.ts';
import { hitKeyReader, Interner } from './memo-keys.ts';

export { NO_COST };
export type { HitCost, StatusCost };

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320: Cobalion's contact moves into Talonflame meet Flame
 * Body, and the races of boostsBiting did not know it): what one hit of a move costs the attacker, read from the
 * simulator (score/contact-play.ts plays the hit on copies of the board) and memoized under everything the hit reads, so
 * that a search which visits thousands of leaves of one board plays each pair once. The cost is the HP the hit takes
 * from the attacker (the foe's item and ability on a contact hit, the move's recoil, the attacker's own item) and
 * the chance of each status it leaves.
 *
 * A hit is played only where something could cost: score/contact-filter.ts says so from the Dex (a handler for the hit on
 * the foe's item or ability, one for the attacker's own move on its item or ability, a move that costs its user), and
 * test/contact-prefilter.spec.ts holds that rule to the simulator over the whole Dex. What the simulator does with the
 * pair (contact at all, Protective Pads, Magic Guard, immunities) is left to the played hit.
 *
 * Not priced, and open: stat drops a contact hit gives (Gooey, Tangling Hair, Cotton Down), the turns a sleep or a
 * paralysis takes, the halved Speed of a paralysis, a Perish Song, an ability swapped by Mummy or Wandering Spirit, the
 * Aftermath of a foe the hit KOs, and what the move does to the stats of its own user (Close Combat).
 */

/** For tests: the pairs played, the readings answered from the memo, the copies played, the pairs that could not cost, the moves probed for a cost of their own. */
export const hitStats = { plays: 0, hits: 0, runs: 0, free: 0, probes: 0 };

/** The memo is a tool of one process; a long session starts over when it has grown past this many pairs. */
const MEMO_LIMIT = 20_000;
const memo = new Map<string, HitCost>();
/** The numbers the memo's keys hold for the keys of the boards and bodies (score/memo-keys.ts); it starts over with the memo. */
const interner = new Interner();

/** For probes: what the memo and the interner of this process hold (entries and characters of the memo's keys, the interned texts). */
export function hitMemoSize(): { entries: number; keyChars: number; interned: number; internedChars: number } {
  let keyChars = 0;
  for (const key of memo.keys()) keyChars += key.length;
  const { entries, chars } = interner.held();
  return { entries: memo.size, keyChars, interned: entries, internedChars: chars };
}

/** For tests and probes: forget the memo, so that the next reading plays its pair again. */
export function resetHitMemo(): void {
  memo.clear();
  interner.reset();
}

const onProbe = (): void => { hitStats.probes++; };

/** For tests: whether anything in the pair could cost the attacker when it uses the move (the rule of score/contact-filter.ts). */
export function hitMayCost(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): boolean {
  const known = factsOf(battle);
  return mayCost(known, battle, attacker, defender, moveOf(known, battle, moveId), onProbe);
}

/** For tests: the cost of one hit as the simulator plays it, with no filter and no memo. */
export function playedHit(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): HitCost {
  return playHit(battle, attacker, defender, moveId);
}

/** The reading function of one battle: the cost of a hit of `moveId` from `attacker` on `defender` (null where the body has no damaging move). */
export type HitReader = (attacker: Pokemon, defender: Pokemon, moveId: string | null) => HitCost;

/** A reader for one evaluation: it keeps the keys of the bodies it has seen, the memo is the process's. */
export function hitReader(battle: Battle): HitReader {
  const known = factsOf(battle);
  const keyOf = hitKeyReader(battle, interner);
  return (attacker, defender, moveId) => {
    if (!moveId) return NO_COST;
    if (!mayCost(known, battle, attacker, defender, moveOf(known, battle, moveId), onProbe)) {
      hitStats.free++;
      return NO_COST;
    }
    let key = keyOf(attacker, defender, moveId);
    let cost = memo.get(key);
    if (cost !== undefined) {
      hitStats.hits++;
      return cost;
    }
    if (memo.size >= MEMO_LIMIT) {
      // The numbers of the old key belong to the interner's last generation: the key is made again after the start over.
      resetHitMemo();
      key = keyOf(attacker, defender, moveId);
    }
    cost = playHit(battle, attacker, defender, moveId, () => { hitStats.runs++; });
    memo.set(key, cost);
    hitStats.plays++;
    return cost;
  };
}
