import type { Battle, Pokemon } from '@pkmn/sim';
import { NO_COST, type HitCost, type StatusCost } from './contact-cost.ts';
import { playHit } from './contact-play.ts';
import { factsOf, mayCost, moveOf } from './contact-filter.ts';
import { hitKeyReader, Interner } from './memo-keys.ts';

export { NO_COST };
export type { HitCost, StatusCost };

// Not priced: stat drops a contact hit gives (Gooey, Tangling Hair), halved paralysis Speed, Perish Song, Mummy swaps,
// Aftermath, the move's own stat changes on its user (Close Combat). Hits play where contact-filter.ts finds a cost.

export const hitStats = { plays: 0, hits: 0, runs: 0, free: 0, probes: 0 };

const MEMO_LIMIT = 20_000;
const memo = new Map<string, HitCost>();
const interner = new Interner();

/** @public A probe hook that no spec or source calls; docs/perf/probes read it (knip skips it by this tag). */
export function hitMemoSize(): { entries: number; keyChars: number; interned: number; internedChars: number } {
  let keyChars = 0;
  for (const key of memo.keys()) keyChars += key.length;
  const { entries, chars } = interner.held();
  return { entries: memo.size, keyChars, interned: entries, internedChars: chars };
}

export function resetHitMemo(): void {
  memo.clear();
  interner.reset();
}

const onProbe = (): void => { hitStats.probes++; };

export function hitMayCost(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): boolean {
  const known = factsOf(battle);
  return mayCost(known, battle, attacker, defender, moveOf(known, battle, moveId), onProbe);
}

export function playedHit(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): HitCost {
  return playHit(battle, attacker, defender, moveId);
}

/** `moveId` is null where the body has no damaging move. */
export type HitReader = (attacker: Pokemon, defender: Pokemon, moveId: string | null) => HitCost;

export function hitReader(battle: Battle): HitReader {
  const known = factsOf(battle);
  let keyOf: ReturnType<typeof hitKeyReader> | undefined;
  return (attacker, defender, moveId) => {
    if (!moveId) return NO_COST;
    if (!mayCost(known, battle, attacker, defender, moveOf(known, battle, moveId), onProbe)) {
      hitStats.free++;
      return NO_COST;
    }
    keyOf ??= hitKeyReader(battle, interner);
    let key = keyOf(attacker, defender, moveId);
    let cost = memo.get(key);
    if (cost !== undefined) {
      hitStats.hits++;
      return cost;
    }
    if (memo.size >= MEMO_LIMIT) {
      // The old key's numbers belong to the interner's last generation: the key is made again after the start over.
      resetHitMemo();
      key = keyOf(attacker, defender, moveId);
    }
    cost = playHit(battle, attacker, defender, moveId, () => { hitStats.runs++; });
    memo.set(key, cost);
    hitStats.plays++;
    return cost;
  };
}
