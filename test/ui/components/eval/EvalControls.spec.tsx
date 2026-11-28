import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    prefs, onPrefsChange: vi.fn(), running: false, showAuto: true,
    onEvaluate: vi.fn(), onCancel: vi.fn(), result: null, status: 'idle' as EvalStatus, ...overrides,
  };
}

describe('EvalControls', () => {
  test('the header holds the title, the engine link, "Follow", "On load" and the button, with no select in any mode', () => {
    const engines = { engines: [BUILTIN_ENGINE], selected: BUILTIN_ENGINE, select: vi.fn(), add: vi.fn(), remove: vi.fn() };
    const wired = props({ engines });
    const { rerender, container } = render(<EvalControls {...wired} />);
    expect(screen.getByText('Evaluation')).toHaveAttribute('title', 'Built-in engine: it plays the turns in the simulator.');
    expect(screen.queryByText(/built-in engine/)).toBeNull();
    for (const shown of [prefs, { ...prefs, mode: 'auto' as const }, { ...prefs, mode: 'mcts' as const }, { ...prefs, depth: 2 as const }]) {
      rerender(<EvalControls {...wired} prefs={shown} />);
      expect(screen.queryByRole('combobox')).toBeNull();
      expect([...container.querySelector('.ps-eval-controls')!.children].map(child => child.textContent?.trim()))
        .toEqual(['Evaluation', '+ engine', 'Follow', 'On load', 'Evaluate']);
    }
    rerender(<EvalControls {...wired} showAuto={false} />);
    expect([...container.querySelector('.ps-eval-controls')!.children].map(child => child.textContent?.trim()))
      .toEqual(['Evaluation', '+ engine', 'On load', 'Evaluate']);
  });

  test('the two boxes say what each starts and read neither Auto nor Always on', () => {
    render(<EvalControls {...props()} />);
    expect(screen.getByRole('checkbox', { name: 'Follow' }).closest('label')).toHaveAttribute(
      'title',
      'After your first Evaluate in a variation, each position you play or step to evaluates by itself. The engine walk and Play line switch this on. Stays on across sessions.',
    );
    expect(screen.getByRole('checkbox', { name: 'On load' }).closest('label')).toHaveAttribute(
      'title',
      'Analyze game starts by itself when a replay loads, and the newest position of a variation evaluates without a click. Stays on across sessions.',
    );
    expect(screen.queryByRole('checkbox', { name: /^Auto$|Always on/ })).toBeNull();
  });

  test('the checkboxes report their new state, and Follow follows its flag', async () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Follow' }));
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, auto: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'On load' }));
    expect(wired.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, autoAnalyze: true });

    rerender(<EvalControls {...wired} showAuto={false} prefs={{ ...prefs, autoAnalyze: true }} />);
    expect(screen.queryByRole('checkbox', { name: 'Follow' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'On load' })).toBeChecked();
  });

  test('the Evaluation row holds no checkbox for the opponent\'s reply, in any engine', () => {
    const { rerender } = render(<EvalControls {...props()} />);
    expect(screen.queryByRole('checkbox', { name: /Hard mode|Opponent reads my move/ })).toBeNull();
    expect(screen.queryByText(/Hard mode/)).toBeNull();
    rerender(<EvalControls {...props()} prefs={{ ...prefs, hardMode: true }} showAuto={false} />);
    expect(screen.queryByRole('checkbox', { name: /Hard mode|Opponent reads my move/ })).toBeNull();
    expect(screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent?.trim())).toEqual(['On load']);
  });

  test('Evaluate turns into Re-evaluate with a result or a stale state, into Cancel while running', async () => {
    const wired = props();
    const { rerender } = render(<EvalControls {...wired} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(wired.onEvaluate).toHaveBeenCalledTimes(1);

    rerender(<EvalControls {...wired} result={evalResult()} />);
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();
    rerender(<EvalControls {...wired} status="stale" />);
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();

    rerender(<EvalControls {...wired} running status="searching" />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(wired.onCancel).toHaveBeenCalledTimes(1);

    rerender(<EvalControls {...wired} onEvaluate={undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('another engine names itself in the heading title and beside it; the header holds no Engine select, with the add link after the name', () => {
    const bot = { id: 'url:http://localhost:8765/', name: 'My bot', url: 'http://localhost:8765/', source: 'added' as const };
    const engines = { engines: [BUILTIN_ENGINE, bot], selected: bot, select: vi.fn(), add: vi.fn(), remove: vi.fn() };
    const { container } = render(<EvalControls {...props({ engines })} />);
    expect(screen.queryByText(/estimate from/i)).toBeNull();
    expect(screen.getByText('Evaluation')).toHaveAttribute('title', 'Estimate from My bot.');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect([...container.querySelector('.ps-eval-controls')!.children].map(child => child.textContent?.trim()))
      .toEqual(['Evaluation', 'My bot', '+ engine', 'Follow', 'On load', 'Evaluate']);
  });

  test('the built-in engine puts no name beside the title, and an added engine in use puts its name there, and no two elements share a title', () => {
    const bot = { id: 'url:http://localhost:8765/', name: 'Test engine', url: 'http://localhost:8765/', source: 'added' as const };
    const choice = (selected: typeof bot | typeof BUILTIN_ENGINE) => ({ engines: [BUILTIN_ENGINE, bot], selected, select: vi.fn(), add: vi.fn(), remove: vi.fn() });
    const { rerender } = render(<EvalControls {...props({ engines: choice(BUILTIN_ENGINE) })} />);
    expect(screen.queryByText('PS Dashboard')).toBeNull();
    expect(screen.queryByText('Test engine')).toBeNull();
    rerender(<EvalControls {...props({ engines: choice(bot) })} />);
    expect(screen.getByText('Test engine')).toHaveAttribute('title', 'Selected engine: Test engine. Estimate from Test engine.');
    expect(screen.getByText('Evaluation')).toHaveAttribute('title', 'Estimate from Test engine.');
    const titles = [...document.querySelectorAll('.ps-eval-controls [title]')].map(element => element.getAttribute('title'));
    expect(new Set(titles).size).toBe(titles.length);
    rerender(<EvalControls {...props({ engines: undefined })} />);
    expect(screen.queryByText('Test engine')).toBeNull();
  });
});
