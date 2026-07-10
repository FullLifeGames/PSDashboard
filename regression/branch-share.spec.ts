import { test, expect } from '@playwright/test';
import {
  decodeBranchShare,
  deleteSavedBranch,
  encodeBranchShare,
  loadSavedBranches,
  makeBranchSharePayload,
  saveBranchPayload,
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

  test('saved branches can be deleted again (G16)', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };

    try {
      const payload = makeBranchSharePayload({ replay, branchTurn: 3, history, finalLog: '|turn|3' });
      expect(saveBranchPayload(payload)).toHaveLength(1);
      expect(loadSavedBranches(replay.id)).toHaveLength(1);
      expect(deleteSavedBranch(payload)).toHaveLength(0);
      expect(loadSavedBranches(replay.id)).toHaveLength(0);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
