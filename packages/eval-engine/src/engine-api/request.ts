import { extractChannelMessages } from '@pkmn/sim';
import { refreshRequestsFromLiveState } from '../branch/corrections.ts';
import { deserializeBattleExact } from '../forward-model.ts';
import { createRootPosition, type ChoiceOption } from '../forward/position.ts';
import { expandPivotPairs, searchOptions } from '../search/options.ts';
import type { TeraAllowance } from '../types.ts';
import { ENGINE_PROTOCOL, type EngineOption, type EngineRequest } from './protocol.ts';

/** The engine's view of the dashboard's options: a pivot pair splits into the move and its switch-in. */
export function engineOptions(options: ChoiceOption[]): EngineOption[] {
  return options.map(option => {
    const [command, then] = option.choice.split(' > ');
    return then ? { id: option.choice, label: option.label, command, then } : { id: option.choice, label: option.label, command };
  });
}

// A |split| block keeps its public line (channel 0).
function spectatorLog(log: string[]): string[] {
  return extractChannelMessages(log.join('\n'), [0])[0];
}

export function buildEngineRequest(
  serialized: string,
  options: { p1: ChoiceOption[]; p2: ChoiceOption[] },
  budgetMs: number,
  game?: { format?: string },
): EngineRequest {
  const battle = deserializeBattleExact(serialized);
  refreshRequestsFromLiveState(battle);
  return {
    protocol: ENGINE_PROTOCOL,
    format: game?.format ?? battle.format.id,
    simFormat: battle.format.id,
    gen: battle.gen,
    gameType: battle.gameType === 'doubles' ? 'doubles' : 'singles',
    turn: battle.turn,
    log: spectatorLog(battle.log),
    requests: { p1: battle.sides[0].activeRequest ?? null, p2: battle.sides[1].activeRequest ?? null },
    options: { p1: engineOptions(options.p1), p2: engineOptions(options.p2) },
    state: serialized,
    budgetMs,
  };
}

/** A request with the options the dashboard's own matrix ranks here (pivot pairs too), for engine authors. */
export function engineRequestFor(serialized: string, budgetMs = 5000, tera: TeraAllowance = true, format?: string): EngineRequest {
  const root = createRootPosition(serialized);
  return buildEngineRequest(serialized, {
    p1: expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera })),
    p2: expandPivotPairs(root, 'p2', searchOptions(root, 'p2', { tera })),
  }, budgetMs, { format });
}
