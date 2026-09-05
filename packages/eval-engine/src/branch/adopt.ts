import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { deserializeBattleExact } from '../forward-model.ts';
import type { TurnAlignmentRecord } from '../hax-alignment.ts';
import { correctBattleFromSnapshot, refreshRequestsFromLiveState } from './corrections.ts';
import { branchLogForPosition } from './log-sync.ts';
import { openStreams } from './runtime-session.ts';
import type { BranchRuntime } from './types.ts';

export interface AdoptParams {
  /** The position in the engine's stable serialization (a reconstruction's arrival or a captured boundary). */
  serialized: string;
  replayLog: string;
  targetTurn: number;
  /** The turn's snapshot for the arrival corrections; null for a position without one (a lead game). */
  snapshot?: TurnSnapshot | null;
  /** The runtime's protocol log when the reconstruction already built it; else derived from the replay. */
  log?: string[];
  haxAlignment?: TurnAlignmentRecord[];
  /** The reconstruction hit its deadline before the target — validateBranchRuntime reports it. */
  timedOut?: boolean;
}

/**
 * A live branch runtime from a serialized position (round 38): the
 * reconstruction may run elsewhere (a worker) or have run earlier (the
 * exact-position store), and the interactive branch still needs a battle
 * that accepts choices and streams its lines. The sim supports exactly
 * this: a deserialized battle is restarted with a new `send`.
 *
 * The arrival corrections are the tail of reconstructBranchRuntime
 * (snapshot correction, request refresh) — identities on an already
 * corrected position, so a sweep-captured boundary adopts as well as a
 * single-turn arrival. The stable serialization drops the sim's `|t:|`
 * lines, so the sent-log cursor is realigned to the log it actually has;
 * the branch's protocol log is the replay prefix plus active corrections,
 * never battle.log.
 */
export function adoptSerializedRuntime(params: AdoptParams): BranchRuntime {
  const battle = deserializeBattleExact(params.serialized);
  if (params.snapshot) correctBattleFromSnapshot(battle, params.snapshot);
  refreshRequestsFromLiveState(battle);
  battle.sentLogPos = battle.log.length;

  const session = openStreams();
  const { battleStream } = session;
  battle.restart((type, data) => {
    battleStream.pushMessage(type, Array.isArray(data) ? data.join('\n') : data);
    if (type === 'end') battleStream.pushEnd();
  });
  battleStream.battle = battle;

  const log = params.log ? [...params.log] : branchLogForPosition(params.replayLog, params.targetTurn, battle);
  session.collectedLog.push(...log);
  return {
    battleStream,
    streams: session.streams,
    log: session.collectedLog,
    choiceErrors: session.choiceErrors,
    timedOut: params.timedOut ?? false,
    haxAlignment: params.haxAlignment ?? [],
  };
}
