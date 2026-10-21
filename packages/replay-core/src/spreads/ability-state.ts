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

export const abilityStateIds = (): string[] => Object.keys(RULES);

/**
 * What the facts of the hit do to an attacker's ability: `on` switches it on for the calculator, `drop` removes it for the hit
 * (the user of Analytic did not move last, and the calculator's speed comparison would lift the hit anyway).
 */
export function abilityStateAtHit(ability: string | undefined, facts: TurnFacts): { on?: true; drop?: true } {
  const rule = RULES[toId(ability ?? '')];
  if (!rule) return {};
  if (facts[rule.fact]) return { on: true };
  return rule.calcDefault === 'speed' ? { drop: true } : {};
}
