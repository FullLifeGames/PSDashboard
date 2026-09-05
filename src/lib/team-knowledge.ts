import { alternativeItems } from './smogon-stats';
import type { SensitivityTarget } from '@fulllifegames/eval-engine';
import { INFERRED_ITEM_DETAIL, RULED_OUT_ITEM_DETAIL, type OpponentTeamInfo } from '@fulllifegames/replay-core';

/**
 * Guessed-item mons + their usage-plausible alternatives — the search
 * space for the sensitivity probes (flagged-verdict honesty). An item the
 * move order inferred is not probed (its alternatives contradict the
 * evidence), and a dropped Scarf stays dropped among the alternatives.
 */
export function buildSensitivityTargets(
  info: OpponentTeamInfo | null,
  stats: Parameters<typeof alternativeItems>[0],
): SensitivityTarget[] {
  if (!info) return [];
  return info.pokemon
    .filter(mon => mon.item.source === 'guessed' && mon.item.value && mon.item.sourceDetail !== INFERRED_ITEM_DETAIL)
    .map(mon => ({
      species: mon.species,
      items: alternativeItems(stats, mon.species, mon.item.value, mon.item.sourceDetail === RULED_OUT_ITEM_DETAIL
        ? { items: [...(mon.ruledOut?.items ?? []), 'choicescarf'] }
        : mon.ruledOut),
    }))
    .filter(target => target.items.length > 0);
}
