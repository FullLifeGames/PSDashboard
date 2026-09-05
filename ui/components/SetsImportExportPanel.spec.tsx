import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetsImportExportPanel } from '../../src/components/SetsImportExportPanel';

const EXPORT = '=== p1: Alice ===\n\nGarchomp @ Loaded Dice\n- Earthquake\n\n=== p2: Bob ===\n';

describe('SetsImportExportPanel', () => {
  test('starts with the export text, imports the edited text, and shows the returned error', async () => {
    const onImport = vi.fn((text: string) => (text.includes('===') ? null : 'No side headers found.'));
    const onClose = vi.fn();
    render(<SetsImportExportPanel exportText={EXPORT} onImport={onImport} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Import / Export Sets' })).toBeInTheDocument();
    const area = screen.getByRole('textbox');
    expect(area).toHaveValue(EXPORT);

    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(EXPORT);
    expect(screen.queryByRole('alert')).toBeNull();

    await userEvent.clear(area);
    await userEvent.type(area, 'Garchomp @ Leftovers');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No side headers found.');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('copy writes the text to the clipboard and confirms', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<SetsImportExportPanel exportText={EXPORT} onImport={() => null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(EXPORT);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument());
  });
});
