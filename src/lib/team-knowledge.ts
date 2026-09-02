import { alternativeItems } from './smogon-stats';
import type { SensitivityTarget } from '@fulllifegames/eval-engine';
import type { OpponentTeamInfo } from '@fulllifegames/replay-core';

/** Guessed-item mons + their usage-plausible alternatives — the search
 *  space for the sensitivity probes (flagged-verdict honesty). */
export function buildSensitivityTargets(
  info: OpponentTeamInfo | null,
  stats: Parameters<typeof alternativeItems>[0],
): SensitivityTarget[] {
  if (!info) return [];
  return info.pokemon
    .filter(mon => mon.item.source === 'guessed' && mon.item.value)
    .map(mon => ({
      species: mon.species,
      items: alternativeItems(stats, mon.species, mon.item.value, mon.ruledOut),
    }))
    .filter(target => target.items.length > 0);
}
