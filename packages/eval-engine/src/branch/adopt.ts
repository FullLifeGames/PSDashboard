import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { deserializeBattleExact } from '../forward-model.ts';
import type { TurnAlignmentRecord } from '../hax-alignment.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import { alignArrivalDice } from './arrival-dice.ts';
import { correctBattleFromSnapshot, refreshRequestsFromLiveState } from './corrections.ts';
import { branchLogForPosition } from './log-sync.ts';
import { openStreams } from './runtime-session.ts';
import type { BranchRuntime } from './types.ts';

/** The input of `adoptSerializedRuntime`: a serialized position, the replay log and the target turn. */
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
  /** The reconstruction hit its deadline before the target; `validateBranchRuntime` reports it. */
  timedOut?: boolean;
}

/** A live branch runtime from a serialized position: a deserialized battle restarted with a new `send`, accepting choices and streaming its lines. */
export function adoptSerializedRuntime(params: AdoptParams): BranchRuntime {
  // Every reader below sees LF.
  const replayLog = normalizeLineEndings(params.replayLog);
  const battle = deserializeBattleExact(params.serialized);
  // The arrival corrections are identities on an already corrected position.
  if (params.snapshot) correctBattleFromSnapshot(battle, params.snapshot);
  refreshRequestsFromLiveState(battle);
  // A position with a snapshot is put on the seed its turn plays under in the log, whatever dice it carried (a sweep boundary keeps the previous block's state).
  if (params.snapshot) alignArrivalDice(battle, replayLog, params.targetTurn);
  // The stable serialization drops the sim's `|t:|` lines, so the sent-log cursor is realigned.
  battle.sentLogPos = battle.log.length;

  const session = openStreams();
  const { battleStream } = session;
  battle.restart((type, data) => {
    battleStream.pushMessage(type, Array.isArray(data) ? data.join('\n') : data);
    if (type === 'end') battleStream.pushEnd();
  });
  battleStream.battle = battle;

  // The branch's protocol log is the replay prefix plus active corrections, never battle.log.
  const log = params.log ? [...params.log] : branchLogForPosition(replayLog, params.targetTurn, battle);
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
