import { inferReplayFormatId, type ReplayData } from '@fulllifegames/replay-core';

/** The format id of the loaded replay ('' before one loads): the one reading the editor's pools and the dock's What if list share. */
export function replayFormatId(replayData: ReplayData | null | undefined): string {
  return replayData ? inferReplayFormatId(replayData) : '';
}
