import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSimState } from '@fulllifegames/eval-engine';
import type { AppController } from '../../../../src/hooks/useAppController';
import { DockRegion } from '../../../../src/components/dock/DockRegion';
import { simState } from '../../fixtures/sim-state';

const poolCalls = vi.hoisted(() => ({ list: [] as unknown[][] }));
vi.mock('../../../../src/lib/pokemon-options', () => ({
  getMovePool: async (...args: unknown[]) => { poolCalls.list.push(args); return ['Dragon Claw', 'Fire Fang']; },
}));

interface Where { sim: BranchSimState; historyLength: number; liveTip?: boolean; replayData?: { id: string; log: string }; prefs?: { hardMode?: boolean }; setPrefs?: (prefs: object) => void; reads?: string | null }

function appAt({ sim, historyLength, liveTip = true, replayData, prefs = {}, setPrefs = vi.fn(), reads }: Where): AppController {
  const noop = vi.fn();
  return {
    board: {
      timeline: { viewTurn: 2, liveTip, evalViewKey: 'variation:2', viewT0: false },
      deviation: { branchPreparing: false, handleSetChoice: noop, handleExecuteDraft: noop },
    },
    ctx: {
      branch: { simState: sim, executing: false, executeError: null, recordChoice: noop, getBattle: undefined, history: new Array(historyLength).fill({}) },
      meta: { replayGen: 9 },
      replay: { replayData },
      newGame: { record: null },
      evaluation: { prefs, setPrefs },
    },
    engine: {
      positionPicker: null, dockSimState: sim, pickerSeed: null, pickerStale: false, playedAtView: undefined,
      getPickerBattle: undefined, pickerReplayLog: undefined,
      acquire: { exactAcquiringTurn: null },
      dockFill: { pending: false, busy: false, waits: false, engine: { p1: [], p2: [] }, choices: null, deferred: { p1: [], p2: [] }, picks: { p1: [], p2: [] }, queueExecute: noop, onUserChoice: noop, restore: () => null, holdTray: noop, release: noop, arm: noop, ...(reads === undefined ? {} : { reads }) },
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

describe.each([
  ['singles', 'gen9championsou-2600000001', 'gen9championsou'],
  ['doubles', 'gen9championsvgc2026regma-2623421463', 'gen9championsvgc2026regma'],
  ['singles', 'gen9nationaldex-2713067801', 'gen9nationaldex'],
  ['doubles', 'gen9doublesou-2693620934', 'gen9doublesou'],
] as const)('the What if list of a %s game (%s)', (type, id, format) => {
  test(`asks the pool for the format ${format}`, async () => {
    poolCalls.list.length = 0;
    const replayData = { id, log: '' };
    render(<DockRegion app={appAt({ sim: simState(type), historyLength: 0, replayData })} replayId={id} />);
    await userEvent.click(screen.getByRole('button', { name: chipName(type) }));
    await userEvent.click(screen.getByRole('button', { name: /Dice · What if/ }));
    await screen.findByRole('combobox', { name: /Hypothetical move for/ });
    expect(poolCalls.list.length).toBeGreaterThan(0);
    for (const [, gen, askedFormat] of poolCalls.list) {
      expect(gen).toBe(9);
      expect(askedFormat).toBe(format);
    }
  });
});

test('a dock without a loaded replay asks for no format', async () => {
  poolCalls.list.length = 0;
  render(<DockRegion app={appAt({ sim: simState('singles'), historyLength: 0 })} replayId="r1" />);
  await userEvent.click(screen.getByRole('button', { name: chipName('singles') }));
  await userEvent.click(screen.getByRole('button', { name: /Dice · What if/ }));
  await screen.findByRole('combobox', { name: /Hypothetical move for/ });
  expect(poolCalls.list.map(call => call[2])).toEqual(['']);
});

describe.each(['singles', 'doubles'] as const)('the "Opponent reads your move" note of the dock (%s)', type => {
  test('shows only while the preference is on; "Turn off" writes the preference with the flag false and keeps the others', async () => {
    const setPrefs = vi.fn();
    const prefs = { depth: 2, autoAnalyze: true, hardMode: true };
    const view = render(<DockRegion app={appAt({ sim: simState(type), historyLength: 1, prefs: { ...prefs, hardMode: false } })} replayId="r1" />);
    expect(screen.queryByText('Opponent reads your move')).toBeNull();
    view.rerender(<DockRegion app={appAt({ sim: simState(type), historyLength: 1, prefs, setPrefs })} replayId="r1" />);
    expect(screen.getByText('Opponent reads your move')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(setPrefs).toHaveBeenCalledWith({ depth: 2, autoAnalyze: true, hardMode: false });
  });

  test.each([
    ['waiting', 'Opponent reads your move: its reply follows your pick'],
    ['answered', 'Opponent reads your move: its engine slots answer your pick'],
    ['unranked', 'Opponent reads your move: no ranked reply to this pick, so its slots keep the engine\'s choice'],
    ['both', 'Opponent reads your move: both sides hold your picks'],
  ] as const)('the note ends with the tail of the read state %s and "Turn off" follows it', (reads, text) => {
    const prefs = { hardMode: true };
    render(<DockRegion app={appAt({ sim: simState(type), historyLength: 1, prefs, reads })} replayId="r1" />);
    const note = screen.getByText(text);
    expect(note).toHaveClass('ps-dock-source');
    expect(note.nextElementSibling).toBe(screen.getByRole('button', { name: 'Turn off' }));
  });

  test('with the setting off the view\'s read shows nothing', () => {
    render(<DockRegion app={appAt({ sim: simState(type), historyLength: 1, prefs: { hardMode: false }, reads: null })} replayId="r1" />);
    expect(screen.queryByText(/Opponent reads your move/)).toBeNull();
  });
});
