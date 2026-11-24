import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences, TurnAnalysis } from '@fulllifegames/eval-engine';
import { SetupMenu } from '../../../src/components/SetupMenu';
import { DockStatus } from '../../../src/components/dock/DockStatus';
import { exploreTitle } from '../../../src/components/eval/turn-copy';
import type { DockModel } from '../../../src/components/dock/dock-model';
import { GameGraphSection, type GameGraphSectionProps } from '../../../src/components/eval/GameGraphSection';
import { gameReviewEnabled, opponentReadsEnabled } from '../../../src/lib/feature-flags';
import { evalGraph, evalResult, gameReport } from '../fixtures/eval-result';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';

/** Both flags are off unless a build sets its env variable to 1 or true; the ui project's vitest config switches both on for the specs of the two features, so each row stubs the variable it reads. */
afterEach(() => vi.unstubAllEnvs());

const flags = [
  ['Game review', 'VITE_FEATURE_GAME_REVIEW', gameReviewEnabled],
  ['Opponent reads my move', 'VITE_FEATURE_OPPONENT_READS', opponentReadsEnabled],
] as const;

describe.each(flags)('the flag %s', (_name, variable, enabled) => {
  test.each([['1', true], ['true', true], ['0', false], ['false', false], ['', false], ['yes', false]])('%j reads as %s', (value, expected) => {
    vi.stubEnv(variable, value);
    expect(enabled()).toBe(expected);
  });

  test('an unset variable is off', () => {
    vi.stubEnv(variable, undefined);
    expect(enabled()).toBe(false);
  });

  test('the other flag stays as it was', () => {
    vi.stubEnv(variable, '');
    const other = flags.find(entry => entry[1] !== variable)!;
    expect(other[2]()).toBe(true);
  });
});

/**
 * With the flag VITE_FEATURE_OPPONENT_READS off (the default of every build), the Setup menu has no checkbox "Opponent reads my move", the dock
 * has no note "Opponent reads your move" with "Turn off", and no title names the reply rule, even when the caller still passes the setting
 * as on (the stored hardMode of an earlier nightly). The two components do not depend on the game type; the dock row runs on both models
 * only through its empty slot lists.
 */
describe('Setup menu with the flag off', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  test.each([[false], [true]])('no checkbox for the reply rule (setting passed as %s); the other entries stay', async passed => {
    render(
      <SetupMenu animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={passed} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.queryByRole('checkbox', { name: /Opponent reads/ })).toBeNull();
    expect(screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent?.trim())).toEqual(['Animate branch turns']);
    expect(screen.getByRole('button', { name: 'Edit Player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import/Export Sets' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/Opponent reads|reads my move/);
  });
});

describe('turn dock with the flag off', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  const model = { p1: [], p2: [], flags: {} } as unknown as DockModel;

  test('a setting passed as on draws no note and no "Turn off"', () => {
    render(<DockStatus source="stored" executeError={null} model={model} diceOpen={false} opponentReads onOpponentReadsChange={vi.fn()} />);
    expect(screen.queryByText('Opponent reads your move')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByText('Choices from the reconstructed position')).toBeInTheDocument();
  });
});

describe('the titles that name the reply rule', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  test('the click title says the opponent plays its top choice, whatever the setting passed', () => {
    expect(exploreTitle(true)).toBe('Play this turn in a variation; the opponent plays its top choice.');
    expect(exploreTitle(false)).toBe('Play this turn in a variation; the opponent plays its top choice.');
  });
});

describe('the Setup checkbox with its flag on and the Game review flag off', () => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_OPPONENT_READS', ''));

  test('its title leaves the Game review out', async () => {
    vi.stubEnv('VITE_FEATURE_OPPONENT_READS', '1');
    vi.stubEnv('VITE_FEATURE_GAME_REVIEW', '');
    render(
      <SetupMenu animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={false} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    const title = screen.getByRole('checkbox', { name: 'Opponent reads my move' }).closest('label')?.getAttribute('title');
    expect(title).toContain('in the turn dock, and in a turn\'s lines. Off, it plays its own top choice');
    expect(title).not.toMatch(/Game review/);
  });
});

/** With VITE_FEATURE_GAME_REVIEW off (the default of every build) the report view shows the cards and the graph and nothing of the Game review. */

const names: [string, string] = ['Alice', 'Bob'];
const prefs: EvalPreferences = { depth: 2, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };

describe.each(['singles', 'doubles'] as const)('%s: the Game review flag off', kind => {
  beforeEach(() => vi.stubEnv('VITE_FEATURE_GAME_REVIEW', ''));

  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 10 }, (_, index) => turnAnalysis(index + 1));
  analyses[3] = turnAnalysis(4, { p1: misplayedSide('mistake') });
  analyses[6] = turnAnalysis(7, { p2: misplayedSide('blunder') });
  const props = (overrides: Partial<GameGraphSectionProps> = {}): GameGraphSectionProps => ({
    onAnalyzeGame: vi.fn(), onCancel: vi.fn(), running: false, hasGraph: true, prefs, graph: evalGraph(kind), playerNames: names,
    currentTurn: 3, selectTurn: vi.fn(), showReportView: true, onBackToReport: vi.fn(), result: evalResult(kind), analyzeTurn: null,
    hasAnalyzeTurn: false, analysis: null, report: gameReport(), reviewAnalyses: analyses, doubles: kind === 'doubles',
    linesHost: { rules: { gen: 9, mod: undefined } }, ...overrides,
  });

  test('the report view has no review section, no marks and no legend, and the text never says "Game review"', () => {
    const { container } = render(<GameGraphSection {...props()} />);
    expect(screen.queryByText('Game review · what the engine would have played')).toBeNull();
    expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(0);
    expect(screen.queryByTestId('graph-marks-legend')).toBeNull();
    expect(container.textContent).not.toMatch(/Game review/);
    expect(container.innerHTML).not.toMatch(/Game review/);
  });

  test('the title of "Back to the main line" does not name the review', () => {
    const { container } = render(<GameGraphSection {...props({ showReportView: false, report: null, onBackToMain: vi.fn(), currentLine: 'variation' })} />);
    const back = screen.getByRole('button', { name: 'Back to the main line' });
    expect(back.getAttribute('title')).toBe('The game report shows on the main line. Same as Main line in the Line selector');
    expect(container.innerHTML).not.toMatch(/Game review/);
  });
});
