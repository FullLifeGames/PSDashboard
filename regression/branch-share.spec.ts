import { test, expect } from '@playwright/test';
import {
  decodeBranchShare,
  encodeBranchShare,
  makeBranchSharePayload,
  savedBranchKey,
} from '../src/lib/branch-share';
import type { BranchHistoryEntry } from '../src/hooks/useBranch';
import type { ReplayData } from '../src/types';

const replay: ReplayData = {
  id: 'gen9ou-123',
  format: '[Gen 9] OU',
  formatid: 'gen9ou',
  players: ['Alice', 'Bob'],
  log: '|start\n|turn|1',
  uploadtime: 0,
  views: 0,
};

const history: BranchHistoryEntry[] = [{
  turnNumber: 1,
  p1Choice: 'move 1',
  p2Choice: 'switch 2',
  p1Active: null,
  p1ActiveSlots: [],
  p2Active: null,
  p2ActiveSlots: [],
  p1Pokemon: [],
  p2Pokemon: [],
}];

test.describe('branch save/share payloads', () => {
  test('round-trips compact share payloads without battle snapshots', () => {
    const payload = makeBranchSharePayload({
      replay,
      branchTurn: 3,
      history,
      finalLog: '|turn|3\n|move|p1a: Test|Tackle|p2a: Test',
    });

    const encoded = encodeBranchShare(payload);
    const decoded = decodeBranchShare(encoded);

    expect(decoded).toMatchObject({
      version: 1,
      replayId: 'gen9ou-123',
      formatid: 'gen9ou',
      players: ['Alice', 'Bob'],
      branchTurn: 3,
      choices: [{ turnNumber: 1, p1Choice: 'move 1', p2Choice: 'switch 2' }],
    });
    expect(decoded.finalLog).toContain('|move|p1a: Test|Tackle|p2a: Test');
  });

  test('uses a stable localStorage key', () => {
    expect(savedBranchKey('gen9ou-123')).toBe('ps-replay-interceptor:branches:gen9ou-123');
  });
});
