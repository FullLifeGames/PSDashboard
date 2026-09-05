import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharedBranchView } from '../../src/components/SharedBranchView';
import type { BranchSharePayload } from '../../src/lib/branch-share';

const branch: BranchSharePayload = {
  version: 1, replayId: 'gen9ou-1', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['Alice', 'Bob'], branchTurn: 3,
  createdAt: '2026-09-05T20:00:00.000Z',
  choices: [{ turnNumber: 3, p1Choice: 'move earthquake', p2Choice: 'move leechseed' }],
  finalLog: '|player|p1|Alice|\n|player|p2|Bob|\n|turn|1\n|turn|2\n|turn|3',
};

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test/shared'), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SharedBranchView', () => {
  test('shows the match, the replayed branch, its choices, and the source; the two buttons route', async () => {
    const onLoadOriginal = vi.fn();
    const onClear = vi.fn();
    render(<SharedBranchView branch={branch} onLoadOriginal={onLoadOriginal} onClear={onClear} />);
    expect(screen.getByText('[Gen 9] OU')).toBeInTheDocument();
    expect(screen.getByText('Shared Branch')).toBeInTheDocument();
    expect(screen.getByTitle('Shared Branch Replay')).toHaveAttribute('src', 'blob:test/shared');
    expect(screen.getByText('Branch started from turn 3. This read-only view replays the shared alternate line.')).toBeInTheDocument();
    expect(screen.getByText('Turn 3: P1 move earthquake / P2 move leechseed')).toBeInTheDocument();
    expect(screen.getByText('gen9ou-1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load Original Replay' }));
    expect(onLoadOriginal).toHaveBeenCalledWith('gen9ou-1');
    await userEvent.click(screen.getByRole('button', { name: 'New Replay' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test('a branch without stored choices says so', () => {
    render(<SharedBranchView branch={{ ...branch, choices: [] }} onLoadOriginal={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('No executed branch choices were stored.')).toBeInTheDocument();
  });
});
