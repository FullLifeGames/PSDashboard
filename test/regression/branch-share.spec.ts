import { test, expect, describe } from 'vitest';
import {
  decodeBranchShare,
  deleteSavedBranch,
  encodeBranchShare,
  loadSavedBranches,
  makeBranchSharePayload,
  saveBranchPayload,
  savedBranchKey,
} from '../../src/lib/branch-share';
import type { BranchHistoryEntry } from '../../src/hooks/useBranch';
import type { ReplayData } from '@fulllifegames/replay-core';

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

describe('branch save/share payloads', () => {
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

  // Round 77 (D6): the shared view reads move and Pokemon names, not the simulator commands.
  test.each([
    ['singles', [{ kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' }], [{ kind: 'switch' as const, speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }], 'Earthquake', '→ Rotom-Wash'],
    ['doubles', [{ kind: 'move' as const, moveId: 'closecombat', moveName: 'Close Combat', targetLoc: 1 }, { kind: 'move' as const, moveId: 'protect', moveName: 'Protect' }], [{ kind: 'switch' as const, speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, null], 'Close Combat +1 + Protect', '→ Rotom-Wash'],
  ])('%s: a payload carries the names the history shows beside the commands', (_kind, p1Slots, p2Slots, p1Label, p2Label) => {
    const named: BranchHistoryEntry = { ...history[0], p1Choice: 'move 1', p2Choice: 'switch 3', p1SlotChoices: p1Slots, p2SlotChoices: p2Slots };
    const forced: BranchHistoryEntry = { ...history[0], kind: 'forced', forcedSide: 'p2', p1Choice: '—', p2Choice: 'switch 2', p2SlotChoices: p2Slots.slice(0, 1) };
    const payload = makeBranchSharePayload({ replay, branchTurn: 3, history: [named, forced], finalLog: '|turn|3' });
    expect(payload.choices[0]).toMatchObject({ p1Choice: 'move 1', p2Choice: 'switch 3', p1Label, p2Label });
    expect(payload.choices[1]).toMatchObject({ forcedSide: 'p2', p2Label });
    const decoded = decodeBranchShare(encodeBranchShare(payload));
    expect(decoded.choices).toEqual(payload.choices);
    expect(decoded.version).toBe(1);
  });

  test('an entry without slot choices keeps the raw command as its label', () => {
    const payload = makeBranchSharePayload({ replay, branchTurn: 3, history, finalLog: '|turn|3' });
    expect(payload.choices[0].p1Label).toBe('move 1');
    expect(payload.choices[0].p2Label).toBe('switch 2');
  });

  // Round 77 (D7): two saves of one branch are two rows, and a delete removes one of them.
  describe('saving the same branch twice', () => {
    const withStore = (run: () => void) => {
      const store = new Map<string, string>();
      (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      };
      try { run(); } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
    };

    test('each save is its own row with its own key, and a delete removes only that row', () => withStore(() => {
      const payload = makeBranchSharePayload({ replay, branchTurn: 3, history, finalLog: '|turn|3' });
      saveBranchPayload(payload);
      const rows = saveBranchPayload(payload);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map(row => row.createdAt)).size).toBe(2);
      expect(rows[0].finalLog).toBe(rows[1].finalLog);
      expect(deleteSavedBranch(rows[0])).toHaveLength(1);
      expect(loadSavedBranches(replay.id)[0].createdAt).toBe(rows[1].createdAt);
    }));

    test('a store that already holds two rows with one key loses one row per delete', () => withStore(() => {
      const payload = makeBranchSharePayload({ replay, branchTurn: 3, history, finalLog: '|turn|3' });
      localStorage.setItem(savedBranchKey(replay.id), JSON.stringify([payload, payload]));
      expect(deleteSavedBranch(payload)).toHaveLength(1);
      expect(deleteSavedBranch(payload)).toHaveLength(0);
    }));
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
      const [row] = saveBranchPayload(payload);
      expect(loadSavedBranches(replay.id)).toHaveLength(1);
      expect(deleteSavedBranch(row)).toHaveLength(0);
      expect(loadSavedBranches(replay.id)).toHaveLength(0);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
