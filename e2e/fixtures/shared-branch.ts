import type { BranchSharePayload } from '../../src/lib/branch-share';
import { fixtureReplay } from '../helpers';

/** A turn-2 branch of the singles fixture, as a share link carries it. */
export const sharedBranchPayload: BranchSharePayload = {
  version: 1,
  replayId: fixtureReplay.id,
  format: fixtureReplay.format,
  formatid: fixtureReplay.formatid,
  players: fixtureReplay.players,
  branchTurn: 2,
  createdAt: '2026-04-29T08:00:00.000Z',
  choices: [{ turnNumber: 2, p1Choice: 'move 1', p2Choice: 'move 2' }],
  finalLog: fixtureReplay.log,
};
