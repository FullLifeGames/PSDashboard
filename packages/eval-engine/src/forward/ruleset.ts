import type { Battle } from '@pkmn/sim';
import type { StaticRuleset } from '../score/weights.ts';

// Kept beside the battle, not on it: the speed layer's copies and guards never see a tag.
const RULESETS = new WeakMap<Battle, StaticRuleset>();

export const battleRuleset = (battle: Battle): StaticRuleset => RULESETS.get(battle) ?? 'standard';

export function tagRuleset(battle: Battle, ruleset: StaticRuleset): Battle {
  if (ruleset === 'standard') RULESETS.delete(battle);
  else RULESETS.set(battle, ruleset);
  return battle;
}
