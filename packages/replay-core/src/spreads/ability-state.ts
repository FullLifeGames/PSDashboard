import { toId } from '../ids.ts';

/** The abilities whose damage reads the turn's order of events (Stakeout, Analytic), which the calculator cannot see from the two bodies. */
// Stakeout reads `defender.activeTurns` of the simulator, Analytic `queue.willMove` of every other active. The calculator takes Stakeout
// from the attacker's `abilityOn` and decides Analytic from the two speeds, which a priority move or a Speed boost contradict.

export interface TurnFacts {
  /** The defender switched in this turn. */
  defenderNewlyIn?: boolean;
  /** Every other active Pokémon had moved when the hit landed. */
  lastToMove?: boolean;
  /** The ability id of the attacker's living partner: shown, the Dex's for a species with one ability, else its set's. */
  allyAbility?: string;
}

interface StateRule {
  fact: keyof TurnFacts;
  /** What the calculator does when the ability is not switched on: nothing (`off`) or its own speed comparison (`speed`). */
  calcDefault: 'off' | 'speed';
}

/** The census (ability-state-census.spec.ts) ties each id to the Dex handler that reads the turn. */
const RULES: Record<string, StateRule> = {
  stakeout: { fact: 'defenderNewlyIn', calcDefault: 'off' },
  analytic: { fact: 'lastToMove', calcDefault: 'speed' },
};

/** Abilities that work while an ally has one of these (Plus and Minus read `allies()` and `hasAbility` of the partner). */
const ALLY_RULES: Record<string, readonly string[]> = {
  // eslint-disable-next-line names/no-new-dex-name -- ability-state-census.spec.ts holds these ids and the abilities they name to the Dex handlers
  plus: ['minus', 'plus'],
  // eslint-disable-next-line names/no-new-dex-name -- the same pair from the other side, held by the same census
  minus: ['minus', 'plus'],
};

export const abilityStateIds = (): string[] => Object.keys(RULES);
export const allyStateIds = (): string[] => Object.keys(ALLY_RULES);

/** Whether an ally with this ability switches any ability on (only those abilities are worth carrying on the observation). */
export const allyAbilityMatters = (ability: string): boolean => Object.values(ALLY_RULES).some(named => named.includes(toId(ability)));

/** What the facts of the hit do to an attacker's ability: `on` switches it on for the calculator, `drop` removes it (the user of Analytic did not move last). */
export function abilityStateAtHit(ability: string | undefined, facts: TurnFacts): { on?: true; drop?: true } {
  const id = toId(ability ?? '');
  const allies = ALLY_RULES[id];
  if (allies) return allies.includes(toId(facts.allyAbility ?? '')) ? { on: true } : {};
  const rule = RULES[id];
  if (!rule) return {};
  if (facts[rule.fact]) return { on: true };
  return rule.calcDefault === 'speed' ? { drop: true } : {};
}
