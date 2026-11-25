import { toId } from '../ids.ts';

/** Turn facts the calculator cannot see: Stakeout reads `defender.activeTurns`, Analytic `queue.willMove`. */

export interface TurnFacts {
  defenderNewlyIn?: boolean;
  /** Every other active Pokémon had moved when the hit landed. */
  lastToMove?: boolean;
  allyAbility?: string;
}

interface StateRule {
  fact: keyof TurnFacts;
  /** What the calculator does when the ability is not switched on: nothing (`off`) or its speed comparison. */
  calcDefault: 'off' | 'speed';
}

// ability-state-census.spec.ts ties each id to the Dex handler that reads the turn.
const RULES: Record<string, StateRule> = {
  stakeout: { fact: 'defenderNewlyIn', calcDefault: 'off' },
  analytic: { fact: 'lastToMove', calcDefault: 'speed' },
};

// Plus and Minus read `allies()` and `hasAbility` of the partner.
const ALLY_RULES: Record<string, readonly string[]> = {
  // eslint-disable-next-line names/no-new-dex-name -- ability-state-census.spec.ts holds these ids and the abilities they name to the Dex handlers
  plus: ['minus', 'plus'],
  // eslint-disable-next-line names/no-new-dex-name -- the same pair from the other side, held by the same census
  minus: ['minus', 'plus'],
};

export const abilityStateIds = (): string[] => Object.keys(RULES);
export const allyStateIds = (): string[] => Object.keys(ALLY_RULES);

export const allyAbilityMatters = (ability: string): boolean => Object.values(ALLY_RULES).some(named => named.includes(toId(ability)));

/** What the hit's facts do to an attacker's ability: `on` switches it on, `drop` removes it (Analytic, not last). */
export function abilityStateAtHit(ability: string | undefined, facts: TurnFacts): { on?: true; drop?: true } {
  const id = toId(ability ?? '');
  const allies = ALLY_RULES[id];
  if (allies) return allies.includes(toId(facts.allyAbility ?? '')) ? { on: true } : {};
  const rule = RULES[id];
  if (!rule) return {};
  if (facts[rule.fact]) return { on: true };
  return rule.calcDefault === 'speed' ? { drop: true } : {};
}
