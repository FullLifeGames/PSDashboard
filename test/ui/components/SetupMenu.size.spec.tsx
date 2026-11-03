import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupMenu } from '../../../src/components/SetupMenu';
import { UI_SCALE_STORAGE_KEY } from '../../../src/lib/ui-scale-setting';
import { getUiScaleState, startUiScale } from '../../../src/lib/ui-scale-store';

/**
 * Round 84 (T315, A7d, spec addendum A, 6a): the Size select of the Setup menu. Auto by default and named with the step it gives
 * now; 100, 125, 150, 175 and 200 % override it and persist per browser; a step that leaves the app less than 1050 px is disabled
 * and says why in its own label.
 */
let stop: (() => void) | null = null;

function windowOf(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

async function openMenu() {
  render(<SetupMenu animateBranchTurns onAnimateChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
  return screen.getByRole('combobox', { name: 'Size' }) as HTMLSelectElement;
}

const labels = (select: HTMLSelectElement) => within(select).getAllByRole('option').map(option => option.textContent);

beforeEach(() => { localStorage.clear(); windowOf(2560, 1290); });
afterEach(() => { stop?.(); stop = null; });

describe('the Size select', () => {
  test('stands in the Setup menu, reads Auto with the step it gives, and lists the five steps', async () => {
    stop = startUiScale();
    const select = await openMenu();
    expect(select.value).toBe('auto');
    expect(labels(select)).toEqual(['Auto (150 %)', '100 %', '125 %', '150 %', '175 %', '200 %']);
    expect(select.closest('.ps-setup-panel')).not.toBeNull();
  });

  test('a choice overrides Auto, persists, and the menu stays open; Auto takes it back', async () => {
    stop = startUiScale();
    const select = await openMenu();
    await userEvent.selectOptions(select, '125 %');
    expect(getUiScaleState()).toMatchObject({ setting: 1.25, scale: 1.25 });
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBe('1.25');
    expect(select.value).toBe('1.25');
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.selectOptions(select, 'Auto (150 %)');
    expect(getUiScaleState()).toMatchObject({ setting: 'auto', scale: 1.5 });
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBeNull();
  });

  test('a stored step is the select\'s value after a reload', async () => {
    localStorage.setItem(UI_SCALE_STORAGE_KEY, '1.75');
    stop = startUiScale();
    const select = await openMenu();
    expect(select.value).toBe('1.75');
    expect(labels(select)[0]).toBe('Auto (150 %)');
  });

  test('a step that leaves the app less than 1050 px is disabled and names the width it needs', async () => {
    windowOf(1600, 1000);
    stop = startUiScale();
    const select = await openMenu();
    const option = (name: RegExp) => within(select).getByRole('option', { name }) as HTMLOptionElement;
    expect(option(/^150 %/).disabled).toBe(false);
    expect(option(/^175 %/).disabled).toBe(true);
    expect(option(/^200 %/).disabled).toBe(true);
    // 1050 times the step, rounded up: 1838 px for 175 %, 2100 px for 200 %.
    expect(option(/^175 %/).textContent).toBe('175 % (needs a window at least 1838 px wide)');
    expect(option(/^200 %/).textContent).toBe('200 % (needs a window at least 2100 px wide)');
    expect(option(/^100 %/).textContent).toBe('100 %');
  });

  test('the window growing enables a step the menu showed disabled', async () => {
    windowOf(1600, 1000);
    stop = startUiScale();
    const select = await openMenu();
    expect((within(select).getByRole('option', { name: /^175 %/ }) as HTMLOptionElement).disabled).toBe(true);
    windowOf(2000, 1000);
    window.dispatchEvent(new Event('resize'));
    expect((await screen.findByRole('option', { name: '175 %' }) as HTMLOptionElement).disabled).toBe(false);
  });
});
