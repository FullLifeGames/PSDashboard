import { toId } from '../ids.ts';

/**
 * Round 73 (T210, group 3): the abilities whose damage reads the turn's order of events, which the calculator cannot see from the
 * two bodies. Stakeout doubles the hit on a target that came in this turn (the simulator reads `defender.activeTurns`); Analytic
 * lifts the hit of the last mover of the turn (`queue.willMove` of every other active). The calculator takes Stakeout from the
 * attacker's `abilityOn` and decides Analytic from the speeds of the two bodies, which a priority move or a Speed boost
 * contradict. The observation carries the two facts of the hit; the table says which fact each ability reads and what the
 * calculator does without it. `hit-history-turn.spec.ts` and `ability-state-census.spec.ts` hold the table to the Dex handlers.
 */

export interface TurnFacts {
  /** The defender switched in this turn. */
  defenderNewlyIn?: boolean;
  /** Every other active Pokémon had moved when the hit landed. */
  lastToMove?: boolean;
  /** The ability id of the attacker's living partner: shown, the Dex's for a species with one ability, else its set's (T203). */
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
/* eslint-disable names/no-new-dex-name -- ability-state-census.spec.ts holds these ids and the abilities they name to the Dex handlers */
const ALLY_RULES: Record<string, readonly string[]> = {
  plus: ['minus', 'plus'],
  minus: ['minus', 'plus'],
};
/* eslint-enable names/no-new-dex-name */

export const abilityStateIds = (): string[] => Object.keys(RULES);
export const allyStateIds = (): string[] => Object.keys(ALLY_RULES);

/** Whether an ally with this ability switches any ability on (only those abilities are worth carrying on the observation). */
export const allyAbilityMatters = (ability: string): boolean => Object.values(ALLY_RULES).some(named => named.includes(toId(ability)));

/**
 * What the facts of the hit do to an attacker's ability: `on` switches it on for the calculator, `drop` removes it for the hit
 * (the user of Analytic did not move last, and the calculator's speed comparison would lift the hit anyway).
 */
export function abilityStateAtHit(ability: string | undefined, facts: TurnFacts): { on?: true; drop?: true } {
  const id = toId(ability ?? '');
  const allies = ALLY_RULES[id];
  if (allies) return allies.includes(toId(facts.allyAbility ?? '')) ? { on: true } : {};
  const rule = RULES[id];
  if (!rule) return {};
  if (facts[rule.fact]) return { on: true };
  return rule.calcDefault === 'speed' ? { drop: true } : {};
}
