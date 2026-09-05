import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchSaveSharePanel } from '../../src/components/BranchSaveSharePanel';
import { decodeBranchShare, savedBranchKey } from '../../src/lib/branch-share';
import type { BranchHistoryEntry } from '../../src/hooks/useBranch';
import { singlesReplay } from '../fixtures/replay';

const replayData = singlesReplay();
const history: BranchHistoryEntry[] = [{
  turnNumber: 2, p1Choice: 'move earthquake', p2Choice: 'move leechseed',
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
}];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BranchSaveSharePanel', () => {
  test('a share link encodes the branch and lands in the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<BranchSaveSharePanel replayData={replayData} branchTurn={2} history={history} finalLog="|turn|3" />);
    expect(screen.queryByLabelText('Branch share link')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    const link = screen.getByLabelText('Branch share link') as HTMLInputElement;
    expect(link.value).toMatch(/#branch=/);
    const payload = decodeBranchShare(link.value.split('#branch=')[1]);
    expect(payload).toMatchObject({ version: 1, replayId: replayData.id, branchTurn: 2, finalLog: '|turn|3', choices: [{ turnNumber: 2, p1Choice: 'move earthquake', p2Choice: 'move leechseed' }] });
    await waitFor(() => expect(screen.getByText('Copied to clipboard.')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(link.value);
  });

  test('saving stores the branch per replay; the list offers to open or delete it', async () => {
    render(<BranchSaveSharePanel replayData={replayData} branchTurn={2} history={history} finalLog="|turn|3" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    const stored = JSON.parse(localStorage.getItem(savedBranchKey(replayData.id))!) as unknown[];
    expect(stored).toHaveLength(1);
    expect(screen.getByText(/Turn 2 branch, 1 choices/)).toBeInTheDocument();

    // Opening navigates to the share hash of the stored branch (a fragment navigation in jsdom).
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(window.location.hash).toMatch(/^#branch=/);
    window.history.replaceState(null, '', '/');

    await userEvent.click(screen.getByRole('button', { name: 'Delete saved branch from turn 2' }));
    expect(screen.queryByText(/Turn 2 branch/)).toBeNull();
    expect(JSON.parse(localStorage.getItem(savedBranchKey(replayData.id)) ?? '[]')).toHaveLength(0);
  });

  test('saved branches of the replay show up on mount', () => {
    localStorage.setItem(savedBranchKey(replayData.id), JSON.stringify([{
      version: 1, replayId: replayData.id, format: replayData.format, formatid: replayData.formatid, players: replayData.players,
      branchTurn: 4, createdAt: '2026-09-05T20:00:00.000Z', choices: [], finalLog: '|turn|4',
    }]));
    render(<BranchSaveSharePanel replayData={replayData} branchTurn={2} history={[]} finalLog="" />);
    expect(screen.getByText(/Turn 4 branch, 0 choices/)).toBeInTheDocument();
  });
});
