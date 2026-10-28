import { parseReplayLog, parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { doublesReplay as DOUBLES } from '../../e2e/fixtures/doubles-replay';
import { vgcReplay as VGC } from '../../e2e/fixtures/vgc-replay';
import singlesJson from '../../e2e/fixtures/replay.json';

/** The e2e suite's singles fixture (a short gen 9 OU game) as fresh data per call. */
const SINGLES = singlesJson as ReplayData;

export type ReplayKind = 'singles' | 'doubles' | 'vgc';

const TEMPLATES: Record<ReplayKind, ReplayData> = { singles: SINGLES, doubles: DOUBLES, vgc: VGC };

export const replayData = (kind: ReplayKind = 'singles'): ReplayData => structuredClone(TEMPLATES[kind]);
export const singlesReplay = () => replayData('singles');
export const doublesReplay = () => replayData('doubles');
export const snapshotsOf = (replay: ReplayData) => parseReplayLog(replay.log);

/** Replay data plus everything the protocol parser reads from its log. */
export function replayFixture(kind: ReplayKind = 'singles') {
  const data = replayData(kind);
  const { snapshots, observations, speedOrders, hpEvidence } = parseReplayLogWithObservations(data.log);
  return { replayData: data, snapshots, observations, speedOrders, hpEvidence };
}
