import type { Battle } from '@pkmn/sim';
import type { StaticRuleset } from '../score/weights.ts';

/**
 * Round 65 (review fix): the rule set a forward-model battle was forked
 * under, kept beside the battle (the battle itself stays untouched, so the
 * speed layer's copies and guards never see it). A root position takes the
 * rule set of its search, every fork and child position inherits it, and
 * the greedy forced-switch pick weighs its trials by it, like the leaves.
 */
const RULESETS = new WeakMap<Battle, StaticRuleset>();

/** The rule set a battle was forked under; untagged battles are standard. */
export const battleRuleset = (battle: Battle): StaticRuleset => RULESETS.get(battle) ?? 'standard';

/** Tags a battle with the rule set of the position it was forked from. */
export function tagRuleset(battle: Battle, ruleset: StaticRuleset): Battle {
  if (ruleset === 'standard') RULESETS.delete(battle);
  else RULESETS.set(battle, ruleset);
  return battle;
}
