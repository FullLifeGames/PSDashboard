import { inferReplayFormatId, type ReplayData } from '@fulllifegames/replay-core';

/** The format id of the loaded replay ('' before one loads). */
export function replayFormatId(replayData: ReplayData | null | undefined): string {
  return replayData ? inferReplayFormatId(replayData) : '';
}
