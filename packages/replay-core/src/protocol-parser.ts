import type { DamageObservation, HiddenPowerEvidence, SpeedOrderObservation, TurnSnapshot } from './types.ts';
import { createParserState, flushSpeedOrder } from './protocol/parser-state.ts';
import {
  appendFinalSnapshot, feedLine, handleActionBoundary, handleCrit, handleDamage, handleGametype, handleGen, handleMove,
  handleResisted, handleSuperEffective, isActionBoundary,
} from './protocol/handlers.ts';

export function parseReplayLog(log: string): TurnSnapshot[] {
  return parseReplayLogWithObservations(log).snapshots;
}

/**
 * One pass over the protocol: the per-tag handlers read the client battle
 * BEFORE the line applies (status, boosts, HP at decision time), then the
 * line feeds the client and turn boundaries take their snapshot. A line
 * reaches at most one evidence handler, in this fixed order.
 */
export function parseReplayLogWithObservations(log: string): {
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
} {
  const state = createParserState();
  const lines = log.split('\n');

  for (const line of lines) {
    state.currentTurnLines.push(line);

    if (line.startsWith('|gametype|')) {
      handleGametype(state, line);
    } else if (line.startsWith('|gen|')) {
      handleGen(state, line);
    } else if (line.startsWith('|move|')) {
      handleMove(state, line);
    } else if (line.startsWith('|-supereffective|')) {
      handleSuperEffective(state, line);
    } else if (line.startsWith('|-resisted|')) {
      handleResisted(state, line);
    } else if (line.startsWith('|-crit|')) {
      handleCrit(state);
    } else if (isActionBoundary(line)) {
      handleActionBoundary(state, line);
    } else if (state.singles && line.startsWith('|-damage|') && !line.includes('[from]') && state.lastMove) {
      handleDamage(state, line);
    }

    feedLine(state, line);
  }
  flushSpeedOrder(state);
  appendFinalSnapshot(state);

  const { snapshots, observations, speedOrders, hpEvidence } = state;
  return { snapshots, observations, speedOrders, hpEvidence };
}
