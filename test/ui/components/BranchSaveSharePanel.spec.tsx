import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchHistoryPanel } from '../../../src/components/BranchHistoryPanel';
import { useBranchSaveShare } from '../../../src/components/useBranchSaveShare';
import { decodeBranchShare, savedBranchKey } from '../../../src/lib/branch-share';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
import { replayFixture, singlesReplay } from '../fixtures/replay';

const replayData = singlesReplay();
const { snapshots } = replayFixture('singles');

/** Round 84 (A7i, ruling 20a): the workspace wires the hook into the history panel; the spec does the same. */
function Panel({ branchHistory = history, finalLog = '|turn|3', data = replayData }: { branchHistory?: BranchHistoryEntry[]; finalLog?: string; data?: typeof replayData }) {
  const slots = useBranchSaveShare({ replayData: data, branchTurn: 2, history: branchHistory, finalLog });
  return <BranchHistoryPanel branchStartTurn={2} history={branchHistory} snapshots={snapshots} slots={slots} />;
}
const toggle = () => screen.getByRole('button', { name: /Variation moves/ });
const openPanel = () => userEvent.click(toggle());
const history: BranchHistoryEntry[] = [{
  turnNumber: 2, p1Choice: 'move earthquake', p2Choice: 'move leechseed',
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
}];

afterEach(() => {
  vi.restoreAllMocks();
});

const SAVED_NOTICE = 'Saved. The saved branches are listed under Variation moves.';

describe('the save and share buttons of the history panel', () => {
  test('both buttons stand on the toggle line with their explanation in the tooltip, and no Save / Share panel remains', () => {
    render(<Panel />);
    const line = toggle().parentElement!;
    const save = screen.getByRole('button', { name: 'Save Branch' });
    const share = screen.getByRole('button', { name: 'Copy Share Link' });
    expect(line).toContainElement(save);
    expect(line).toContainElement(share);
    expect(toggle()).not.toContainElement(save);
    expect(save).toHaveAttribute('title', 'Stores the replay id, branch turn, choices and final branch log in this browser.');
    expect(share).toHaveAttribute('title', 'Copies a link that opens this branch read-only.');
    expect(screen.queryByText('Save / Share Branch')).toBeNull();
  });

  test('a new game offers Save Branch and no share link until the game has its own link (a version 1 link needs a Showdown replay id; H4h)', () => {
    render(<Panel data={{ ...replayData, id: 'newgame-m7nj3hx23e', formatid: 'gen9ou' }} />);
    expect(screen.getByRole('button', { name: 'Save Branch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Share Link' })).toBeNull();
  });

  test('a share link encodes the branch and lands in the clipboard; the field shows under the line while the history is closed', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<Panel />);
    expect(screen.queryByLabelText('Branch share link')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    const link = screen.getByLabelText('Branch share link') as HTMLInputElement;
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(link).toBeVisible();
    expect(link.value).toMatch(/#branch=/);
    const payload = decodeBranchShare(link.value.split('#branch=')[1]);
    expect(payload).toMatchObject({ version: 1, replayId: replayData.id, branchTurn: 2, finalLog: '|turn|3', choices: [{ turnNumber: 2, p1Choice: 'move earthquake', p2Choice: 'move leechseed' }] });
    await waitFor(() => expect(screen.getByText('Copied to clipboard.')).toBeVisible());
    expect(writeText).toHaveBeenCalledWith(link.value);
  });

  test('saving stores the branch per replay; a save while the history is closed says so in one line, and the list sits in the open body', async () => {
    render(<Panel />);
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    const stored = JSON.parse(localStorage.getItem(savedBranchKey(replayData.id))!) as unknown[];
    expect(stored).toHaveLength(1);
    expect(screen.getByText(SAVED_NOTICE)).toBeVisible();
    expect(screen.getByText(/Turn 2 branch, 1 choices/)).not.toBeVisible();

    await openPanel();
    expect(screen.queryByText(SAVED_NOTICE)).toBeNull();
    expect(screen.getByText(/Turn 2 branch, 1 choices/)).toBeVisible();

    // Opening navigates to the share hash of the stored branch (a fragment navigation in jsdom).
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(window.location.hash).toMatch(/^#branch=/);
    window.history.replaceState(null, '', '/');

    await userEvent.click(screen.getByRole('button', { name: 'Delete saved branch from turn 2' }));
    expect(screen.queryByText(/Turn 2 branch/)).toBeNull();
    expect(JSON.parse(localStorage.getItem(savedBranchKey(replayData.id)) ?? '[]')).toHaveLength(0);
  });

  test('a save while the history is open shows the row and no notice', async () => {
    render(<Panel />);
    await openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    expect(screen.getByText(/Turn 2 branch, 1 choices/)).toBeVisible();
    expect(screen.queryByText(SAVED_NOTICE)).toBeNull();
  });

  test('saving twice lists two rows, and one Delete removes one of them', async () => {
    render(<Panel />);
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Branch' }));
    await openPanel();
    expect(screen.getAllByText(/Turn 2 branch, 1 choices/)).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(savedBranchKey(replayData.id))!)).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete saved branch from turn 2' })[0]);
    expect(screen.getAllByText(/Turn 2 branch, 1 choices/)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(savedBranchKey(replayData.id))!)).toHaveLength(1);
  });

  test('saved branches of the replay show up on mount, in the body, and with no notice', async () => {
    localStorage.setItem(savedBranchKey(replayData.id), JSON.stringify([{
      version: 1, replayId: replayData.id, format: replayData.format, formatid: replayData.formatid, players: replayData.players,
      branchTurn: 4, createdAt: '2026-09-05T20:00:00.000Z', choices: [], finalLog: '|turn|4',
    }]));
    render(<Panel branchHistory={[]} finalLog="" />);
    expect(screen.getByText(/Turn 4 branch, 0 choices/)).not.toBeVisible();
    expect(screen.queryByText(SAVED_NOTICE)).toBeNull();
    await openPanel();
    expect(screen.getByText(/Turn 4 branch, 0 choices/)).toBeVisible();
  });
});
