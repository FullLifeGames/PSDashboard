import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';
import type { DieOffer } from './offer.ts';
import { RecordingPRNG } from './prng.ts';
import type { DieName, Draw } from './types.ts';
import { watchBattle } from './watch.ts';

interface FixedMove { id: string; multihit?: number | number[] }
type Base = Omit<DieName, 'kind' | 'targetSlot'>;

const bodyAt = (battle: Battle, slot: string): Pokemon | undefined => battle.sides.flatMap(side => side.active).find(body => body?.getSlot() === slot) ?? undefined;

class HittingPRNG extends RecordingPRNG {
  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const answer = super.decide(name, draw, natural);
    return name.kind === 'accuracy' && draw.call === 'chance' ? 0 : answer;
  }
}

// Each rule runs its own ModifyMove on a fresh move; a rule the user cannot use (Gastro Acid, Embargo) is skipped.
function fixingRule(copy: Battle, user: Pokemon, target: Pokemon | undefined, moveId: string): { name: string } | undefined {
  const dexMove = copy.dex.moves.get(moveId) as unknown as { multihit?: number | number[]; multiaccuracy?: boolean };
  const events = copy as unknown as {
    singleEvent(...args: unknown[]): unknown; setActiveMove(move: unknown, pokemon: Pokemon, target?: Pokemon): void; clearActiveMove(failed?: boolean): void;
  };
  const rules = [
    { effect: user.getAbility(), state: user.abilityState, off: user.ignoringAbility() },
    { effect: user.getItem(), state: user.itemState, off: user.ignoringItem() },
  ];
  for (const { effect, state, off } of rules) {
    if (off || !effect.exists) continue;
    const fresh = copy.dex.getActiveMove(moveId) as unknown as { multihit?: number | number[]; multiaccuracy?: boolean };
    events.setActiveMove(fresh, user, target);
    try {
      events.singleEvent('ModifyMove', effect, state, user, target, fresh, fresh);
    } finally {
      events.clearActiveMove(true);
    }
    if (!!fresh.multiaccuracy !== !!dexMove.multiaccuracy || (Array.isArray(dexMove.multihit) && !Array.isArray(fresh.multihit))) return effect;
  }
  return undefined;
}

// Drawn when the stream names a hit-count die (Loaded Dice takes 10 - random(7) for ten hits), undrawn when the turn
// showed |-hitcount| without one. undefined: the move never reached its hits (the target is immune).
function countIsDrawn(battle: Battle, slot: string, moveId: string, aimedSlot: string): boolean | undefined {
  const copy = copyOf(battle);
  copy.prng ??= battle.prng.clone();
  const user = bodyAt(copy, slot);
  const aimed = bodyAt(copy, aimedSlot);
  if (!user || !aimed) return undefined;
  const watch = watchBattle(copy);
  const recording = new HittingPRNG(copy.prng, watch);
  copy.prng = recording;
  const start = copy.log.length;
  try {
    copy.actions.useMove(moveId, user, { target: aimed });
  } finally {
    watch.uninstall();
  }
  if ([...recording.names.values()].some(name => name.kind === 'hit-count')) return true;
  return copy.log.slice(start).some(line => line.startsWith('|-hitcount|')) ? false : undefined;
}

/** A holder whose rule leaves a draw (Loaded Dice on ten hits) shows no row; Skill Link shows "Hits: 5". */
export function fixedCountOffers(battle: Battle, copy: Battle, user: Pokemon, move: FixedMove, base: Base, targets: Pokemon[]): DieOffer[] {
  const dexMove = copy.dex.moves.get(move.id) as unknown as { multihit?: number | number[]; multiaccuracy?: boolean };
  const hits = typeof move.multihit === 'number' ? Math.floor(move.multihit) : 0;
  if (hits < 2 || !(Array.isArray(dexMove.multihit) || dexMove.multiaccuracy)) return [];
  const aimed = targets.find(target => !target.fainted);
  const rule = aimed && fixingRule(copy, user, aimed, move.id);
  if (!aimed || !rule || countIsDrawn(battle, user.getSlot(), move.id, aimed.getSlot()) !== false) return [];
  return [{ name: { ...base, kind: 'hit-count' }, results: [{ hits }], fixedBy: rule.name }];
}
