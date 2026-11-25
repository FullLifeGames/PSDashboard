import type { RulesDex } from '../rules-dex.ts';

type ItemHandler = (this: never, ...args: never[]) => unknown;
export type SelfItem = { onAfterMoveSecondarySelf?: ItemHandler };

const ownMoveItems = new WeakMap<RulesDex, string[]>();

/** Whether the item's own `onAfterMoveSecondarySelf` spends it after its holder's move; a throw reads as no. */
export function spendsAfterOwnMove(dex: RulesDex, itemId: string, moveName: string): boolean {
  const handler = (dex.items.get(itemId) as unknown as SelfItem).onAfterMoveSecondarySelf;
  if (!handler) return false;
  let spent = false;
  const spend = () => { spent = true; return true; };
  const holder = { useItem: spend, eatItem: spend, baseMaxhp: 100, forceSwitchFlag: false };
  try {
    handler.call({ dex } as never, holder as never, {} as never, dex.getActiveMove(moveName) as never);
  } catch {
    return false;
  }
  return spent;
}

export function spentAfterOwnMove(dex: RulesDex): string[] {
  let ids = ownMoveItems.get(dex);
  if (!ids) {
    const moves = dex.moves.all().filter(move => move.exists && move.category !== 'Status');
    const items = dex.items.all().filter(item => item.exists && item.gen <= dex.gen && !!(item as unknown as SelfItem).onAfterMoveSecondarySelf);
    ids = items.filter(item => moves.some(move => spendsAfterOwnMove(dex, item.id, move.name))).map(item => item.id);
    ownMoveItems.set(dex, ids);
  }
  return ids;
}

type HitHandlers = Partial<Record<'onAfterMoveSecondary' | 'onDamagingHit' | 'onHit' | 'onTryEatItem', ItemHandler>>;
type StandInMove = ReturnType<RulesDex['getActiveMove']>;

/** What the log says about a hit on the holder; a blocker is true when it may hold, so a true one stops the verdict. */
export interface HitFacts {
  typeMod: number;
  healBlocked: boolean;
  berryStopped: boolean;
  secondariesOff: boolean;
  holderMay: (ability: string) => boolean;
  attackerMay: (ability: string) => boolean;
}

const NOTHING_BLOCKS: HitFacts = { typeMod: 1, healBlocked: false, berryStopped: false, secondariesOff: false, holderMay: () => false, attackerMay: () => false };
const hitItems = new WeakMap<RulesDex, string[]>();
const shifters = new WeakMap<RulesDex, ReadonlySet<string>>();

function spendsOnMove(dex: RulesDex, itemId: string, move: StandInMove, facts: HitFacts): boolean {
  const item = dex.items.get(itemId) as unknown as HitHandlers;
  let spent = false;
  const nothing = () => undefined;
  const battle = {
    dex, effect: {}, effectState: {}, add: nothing, damage: nothing, heal: nothing, boost: nothing,
    runEvent: (event: string) => !(facts.healBlocked && event === 'TryHeal'),
  };
  const target = {
    hp: 1, baseMaxhp: 100, isActive: true, getMoveHitData: () => ({ typeMod: facts.typeMod }), hasAbility: facts.holderMay,
    useItem: () => (spent = true),
    eatItem: () => {
      if (facts.berryStopped || item.onTryEatItem?.call(battle as never, item as never, target as never) === false) return false;
      spent = true;
      return true;
    },
  };
  const source = { hp: 1, isActive: true, baseMaxhp: 100, hasAbility: facts.attackerMay };
  try {
    if (!facts.secondariesOff) item.onAfterMoveSecondary?.call(battle as never, target as never, source as never, move as never);
    item.onDamagingHit?.call(battle as never, 1 as never, target as never, source as never, move as never);
    item.onHit?.call(battle as never, target as never, source as never, move as never);
  } catch {
    return false;
  }
  return spent;
}

export function spendsOnHit(dex: RulesDex, itemId: string, moveName: string, facts: HitFacts): { fires: boolean; readsKind: boolean } {
  const move = dex.getActiveMove(moveName);
  const fires = spendsOnMove(dex, itemId, move, facts);
  if (!fires) return { fires, readsKind: false };
  const variants = [...dex.types.names().map(type => ({ ...move, type })), ...(['Physical', 'Special'] as const).map(category => ({ ...move, category }))];
  return { fires, readsKind: variants.some(variant => spendsOnMove(dex, itemId, variant as StandInMove, facts) !== fires) };
}

export function spentByHit(dex: RulesDex): string[] {
  let ids = hitItems.get(dex);
  if (!ids) {
    const moves = dex.moves.all().filter(move => move.exists && move.category !== 'Status').map(move => dex.getActiveMove(move.name));
    const items = dex.items.all().filter(item => {
      const handlers = item as unknown as HitHandlers;
      return item.exists && item.gen <= dex.gen && !!(handlers.onAfterMoveSecondary || handlers.onDamagingHit || handlers.onHit);
    });
    ids = items.filter(item => moves.some(move => spendsOnMove(dex, item.id, move, NOTHING_BLOCKS))).map(item => item.id);
    hitItems.set(dex, ids);
  }
  return ids;
}

export function kindShifters(dex: RulesDex): ReadonlySet<string> {
  let ids = shifters.get(dex);
  if (!ids) {
    const damaging = dex.moves.all().filter(move => move.exists && move.category !== 'Status');
    const samples = [damaging[0], damaging.find(move => move.type !== damaging[0].type)!];
    const changes = (ability: { onModifyMove?: ItemHandler }) => samples.some(sample => {
      const move = { ...dex.getActiveMove(sample.name) };
      try {
        ability.onModifyMove?.call({ dex } as never, move as never, {} as never);
      } catch {
        return false;
      }
      return move.type !== sample.type;
    });
    ids = new Set(dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen
      && (Object.keys(ability).some(key => /^on\w*ModifyType/.test(key)) || changes(ability as unknown as { onModifyMove?: ItemHandler }))).map(ability => ability.id));
    shifters.set(dex, ids);
  }
  return ids;
}
