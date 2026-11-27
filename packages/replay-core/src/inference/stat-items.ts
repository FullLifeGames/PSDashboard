import type { RulesDex } from '../rules-dex.ts';

type Handler = (this: never, ...args: never[]) => unknown;
type Boosts = Record<string, number>;
type StatItem = Partial<Record<(typeof BOUNDARY_EVENTS)[number] | 'onFoeAfterBoost' | 'onAfterBoost', Handler>>;

export interface FoeBoost { boost: Boosts; effect: string }

const BOUNDARY_EVENTS = ['onStart', 'onAnySwitchIn', 'onAnyAfterMega', 'onAnyAfterTerastallization', 'onAnyAfterMove', 'onResidual'] as const;
const noBoosts = (): Boosts => ({});
const itemOf = (dex: RulesDex, id: string) => dex.items.get(id) as unknown as StatItem;
const inDex = (dex: RulesDex) => dex.items.all().filter(item => item.exists && item.gen <= dex.gen);

function spendsAtBoundary(dex: RulesDex, id: string, boosts: Boosts, heard: readonly FoeBoost[] = []): boolean {
  const item = itemOf(dex, id);
  let spent = false;
  const holder = { boosts: { ...boosts }, hp: 100, isActive: true, useItem: () => (spent = true) };
  const context = { dex, effect: item, effectState: { target: holder } as Record<string, unknown> };
  try {
    for (const { boost, effect } of heard) item.onFoeAfterBoost?.call(context as never, boost as never, {} as never, {} as never, { name: effect } as never);
    for (const event of BOUNDARY_EVENTS) item[event]?.call(context as never, holder as never);
  } catch {
    return false;
  }
  return spent;
}

const cached = <T>(make: (dex: RulesDex) => T) => {
  const found = new WeakMap<RulesDex, T>();
  return (dex: RulesDex): T => found.get(dex) ?? (found.set(dex, make(dex)), found.get(dex) as T);
};

export const standingItems = cached(dex => inDex(dex).map(item => item.id)
  .filter(id => spendsAtBoundary(dex, id, { atk: -1 }) && !spendsAtBoundary(dex, id, noBoosts())));

export const spendsStanding = (dex: RulesDex, id: string, boosts: Boosts): boolean => spendsAtBoundary(dex, id, boosts);

const RAISED: FoeBoost = { boost: { atk: 1 }, effect: '' };

export const foeBoostItems = cached(dex => inDex(dex).map(item => item.id)
  .filter(id => !!itemOf(dex, id).onFoeAfterBoost && spendsAtBoundary(dex, id, noBoosts(), [RAISED]) && !spendsAtBoundary(dex, id, noBoosts())));

export const spendsAfterFoeBoosts = (dex: RulesDex, id: string, heard: readonly FoeBoost[]): boolean => spendsAtBoundary(dex, id, noBoosts(), heard);

export function spendsAfterBoost(dex: RulesDex, id: string, boost: Boosts, effect: string, boosts: Boosts): boolean {
  let spent = false;
  const target = { boosts: { ...boosts }, hp: 100, isActive: true, useItem: () => (spent = true) };
  try {
    itemOf(dex, id).onAfterBoost?.call({ dex } as never, { ...boost } as never, target as never, {} as never, { name: effect } as never);
  } catch {
    return false;
  }
  return spent;
}

const afterBoostEffects = cached(dex => {
  const effects = [...dex.abilities.all(), ...dex.items.all(), ...dex.moves.all()].filter(entry => entry.exists).map(entry => entry.name);
  const reacting = inDex(dex).filter(item => !!itemOf(dex, item.id).onAfterBoost);
  return new Map(reacting.map(item => [item.id, effects.filter(name => spendsAfterBoost(dex, item.id, { atk: -1 }, name, noBoosts()))]));
});

export const boostAnswers = (dex: RulesDex): ReadonlyMap<string, readonly string[]> =>
  new Map([...afterBoostEffects(dex)].filter(([, effects]) => effects.length > 0));
