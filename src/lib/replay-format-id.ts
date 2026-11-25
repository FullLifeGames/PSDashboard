import { inferReplayFormatId, type ReplayData } from '@fulllifegames/replay-core';

export function replayFormatId(replayData: ReplayData | null | undefined): string {
  return replayData ? inferReplayFormatId(replayData) : '';
}
