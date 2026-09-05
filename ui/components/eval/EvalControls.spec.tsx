import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { EvalControls } from '../../../src/components/eval/EvalControls';
import type { EvalStatus } from '../../../src/hooks/useEvaluation';
import { evalResult } from '../../fixtures/eval-result';

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
  test('the depth select routes to a matrix depth, MCTS, or auto; samples only apply under matrix', async () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    expect(screen.getByText('Evaluation')).toBeInTheDocument();
    expect(screen.getByText('estimate from a sim search, no oracle')).toBeInTheDocument();

    await userEvent.selectOptions(select('Depth'), '2');
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, mode: 'matrix', depth: 2 });
    await userEvent.selectOptions(select('Depth'), 'mcts');
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, mode: 'mcts' });
    await userEvent.selectOptions(select('Samples'), '5');
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, samples: 5 });

    rerender(<EvalControls {...wired} prefs={{ ...prefs, mode: 'auto' }} />);
    expect(select('Depth')).toHaveValue('auto');
    expect(screen.queryByText('Samples')).toBeNull();
    rerender(<EvalControls {...wired} prefs={{ ...prefs, depth: 2 }} />);
    expect(select('Depth')).toHaveValue('2');
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

  test('Evaluate turns into Re-evaluate with a result or a stale state, into Cancel while running; running locks the selects', async () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(wired.onEvaluate).toHaveBeenCalledTimes(1);
    expect(select('Depth')).toBeEnabled();

    rerender(<EvalControls {...wired} result={evalResult()} />);
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();
    rerender(<EvalControls {...wired} status="stale" />);
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();

    rerender(<EvalControls {...wired} running status="searching" />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(wired.onCancel).toHaveBeenCalledTimes(1);
    expect(select('Depth')).toBeDisabled();
    expect(select('Tera')).toBeDisabled();

    rerender(<EvalControls {...wired} onEvaluate={undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
