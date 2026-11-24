import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { EvalControls } from '../../../../src/components/eval/EvalControls';
import type { EvalStatus } from '../../../../src/hooks/useEvaluation';
import { evalResult } from '../../fixtures/eval-result';
import { BUILTIN_ENGINE } from '../../../../src/lib/engines/registry';

const prefs: EvalPreferences = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };

type Props = Parameters<typeof EvalControls>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    prefs, onPrefsChange: vi.fn(), running: false, showAuto: true, showTera: true,
    onEvaluate: vi.fn(), onCancel: vi.fn(), result: null, status: 'idle' as EvalStatus, ...overrides,
  };
}

/** The select inside the label that names it. */
const select = (label: string) => within(screen.getByText(label)).getByRole('combobox');

describe('EvalControls', () => {
  test('the header holds the title, Tera and "Always on", and no Depth or Samples in any mode', () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    expect(screen.getByText('Evaluation')).toBeInTheDocument();
    expect(screen.queryByText(/built-in engine/)).toBeNull();
    expect(screen.getByText('Evaluation')).toHaveAttribute('title', 'Built-in engine: it plays the turns in the simulator.');
    for (const shown of [prefs, { ...prefs, mode: 'auto' as const }, { ...prefs, mode: 'mcts' as const }, { ...prefs, depth: 2 as const }]) {
      rerender(<EvalControls {...wired} prefs={shown} />);
      expect(screen.queryByText('Depth')).toBeNull();
      expect(screen.queryByText('Samples')).toBeNull();
      expect(screen.getAllByRole('combobox').map(box => box.closest('label')?.textContent?.trim().slice(0, 4))).toEqual(['Tera']);
    }
  });

  test('tera and auto follow their visibility flags; the checkboxes report their new state', async () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    await userEvent.selectOptions(select('Tera'), 'revealed');
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, tera: 'revealed' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto' }));
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, auto: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Always on' }));
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, autoAnalyze: true });

    rerender(<EvalControls {...wired} showAuto={false} showTera={false} prefs={{ ...prefs, autoAnalyze: true }} />);
    expect(screen.queryByText('Tera')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Auto' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Always on' })).toBeChecked();
  });

  test('the Evaluation row holds no checkbox for the opponent\'s reply, in any engine', () => {
    const { rerender } = render(<EvalControls {...props()} />);
    expect(screen.queryByRole('checkbox', { name: /Hard mode|Opponent reads my move/ })).toBeNull();
    expect(screen.queryByText(/Hard mode/)).toBeNull();
    rerender(<EvalControls {...props()} prefs={{ ...prefs, hardMode: true }} showAuto={false} />);
    expect(screen.queryByRole('checkbox', { name: /Hard mode|Opponent reads my move/ })).toBeNull();
    expect(screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent?.trim())).toEqual(['Always on']);
  });

  test('Evaluate turns into Re-evaluate with a result or a stale state, into Cancel while running; running locks Tera', async () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(wired.onEvaluate).toHaveBeenCalledTimes(1);
    expect(select('Tera')).toBeEnabled();

    rerender(<EvalControls {...wired} result={evalResult()} />);
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();
    rerender(<EvalControls {...wired} status="stale" />);
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();

    rerender(<EvalControls {...wired} running status="searching" />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(wired.onCancel).toHaveBeenCalledTimes(1);
    expect(select('Tera')).toBeDisabled();

    rerender(<EvalControls {...wired} onEvaluate={undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('another engine names itself in the heading title and the Engine select title, not in a line of text', () => {
    const bot = { id: 'url:http://localhost:8765/', name: 'My bot', url: 'http://localhost:8765/', source: 'added' as const };
    const engines = { engines: [BUILTIN_ENGINE, bot], selected: bot, select: vi.fn(), add: vi.fn(), remove: vi.fn() };
    render(<EvalControls {...props({ engines })} />);
    expect(screen.queryByText(/estimate from/i)).toBeNull();
    expect(screen.getByText('Evaluation')).toHaveAttribute('title', 'Estimate from My bot.');
    expect(screen.getByRole('combobox', { name: 'Engine' }).closest('label')).toHaveAttribute('title', expect.stringContaining('Estimate from My bot.'));
  });

  test('the built-in engine reaches the Engine select title too', () => {
    const engines = { engines: [BUILTIN_ENGINE, { id: 'u', name: 'Other', url: 'http://x/', source: 'added' as const }], selected: BUILTIN_ENGINE, select: vi.fn(), add: vi.fn(), remove: vi.fn() };
    render(<EvalControls {...props({ engines })} />);
    expect(screen.getByRole('combobox', { name: 'Engine' }).closest('label')).toHaveAttribute('title', expect.stringContaining('Built-in engine: it plays the turns in the simulator.'));
  });
});
