import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSimState } from '@fulllifegames/eval-engine';
import type { AppController } from '../../../../src/hooks/useAppController';
import { DockRegion } from '../../../../src/components/dock/DockRegion';
import { simState } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/**
 * Round 84 (A7g): a forced replacement and the choice after it share the turn, so the dock's position key needs the step within
 * the turn. A bench click sends the replacement at once; the next request at the same turn must not inherit the open tray.
 */
interface Where { sim: BranchSimState; historyLength: number; liveTip?: boolean }

function appAt({ sim, historyLength, liveTip = true }: Where): AppController {
  const noop = vi.fn();
  return {
    board: {
      timeline: { viewTurn: 2, liveTip, evalViewKey: 'variation:2', viewT0: false },
      deviation: { branchPreparing: false, handleSetChoice: noop, handleExecuteDraft: noop },
    },
    ctx: {
      branch: { simState: sim, executing: false, executeError: null, recordChoice: noop, getBattle: undefined, history: new Array(historyLength).fill({}) },
      meta: { replayGen: 9 },
      replay: { replayData: undefined },
      newGame: { record: null },
    },
    engine: {
      positionPicker: null, dockSimState: sim, pickerSeed: null, pickerStale: false, playedAtView: undefined,
      getPickerBattle: undefined, pickerReplayLog: undefined,
      acquire: { exactAcquiringTurn: null },
      dockFill: { pending: false, busy: false, waits: false, engine: { p1: [], p2: [] }, choices: null, deferred: { p1: [], p2: [] }, queueExecute: noop, onUserChoice: noop, holdTray: noop, release: noop, arm: noop },
    },
    transients: { playOut: null, pendingConfirm: null, setPendingConfirm: noop },
    handleHypotheticalMove: noop, handleExecuteTurn: noop,
  } as unknown as AppController;
}

const forced = (type: 'singles' | 'doubles') => simState(type, { p2ForceSwitch: true, p2ForceSwitches: type === 'singles' ? [true] : [true, false] });
const label = (type: 'singles' | 'doubles') => (type === 'singles' ? 'P2' : 'P2A');
const chipName = (type: 'singles' | 'doubles') => new RegExp(`^${label(type)}\\b`);

describe.each(['singles', 'doubles'] as const)('the tray at a forced replacement (%s)', type => {
  test('the bench click sends, the next request at the same turn has no tray open', async () => {
    const view = render(<DockRegion app={appAt({ sim: forced(type), historyLength: 1 })} replayId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: chipName(type) }));
    expect(document.querySelector('.ps-tray')).not.toBeNull();
    // The replacement went in: same turn, one more history entry, the choice after it.
    view.rerender(<DockRegion app={appAt({ sim: simState(type), historyLength: 2 })} replayId="r1" />);
    expect(document.querySelector('.ps-tray')).toBeNull();
  });

  test('a record that leaves the position where it is keeps the tray open', async () => {
    const view = render(<DockRegion app={appAt({ sim: forced(type), historyLength: 1 })} replayId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: chipName(type) }));
    view.rerender(<DockRegion app={appAt({ sim: { ...forced(type) }, historyLength: 1 })} replayId="r1" />);
    expect(document.querySelector('.ps-tray')).not.toBeNull();
  });
});
