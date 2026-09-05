import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ComboBox } from '../../src/components/ComboBox';

const OPTIONS = ['Earthquake', 'Earth Power', 'Fire Fang', 'Scale Shot', 'Stone Edge'];

/** A controlled host, as the editor fields use it. */
function Host({ onSelect, onEnterFreeText, onBlur, disabled }: {
  onSelect: (option: string) => void;
  onEnterFreeText?: (text: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <ComboBox
      options={OPTIONS} value={value} onChange={setValue} onSelect={option => { onSelect(option); setValue(option); }}
      onEnterFreeText={onEnterFreeText} onBlur={onBlur} ariaLabel="Add move" placeholder="Add move..." disabled={disabled}
    />
  );
}

describe('ComboBox', () => {
  test('typing filters the options with prefix matches first; a click selects', async () => {
    const onSelect = vi.fn();
    render(<Host onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Add move' });
    await userEvent.type(input, 'ea');
    const shown = screen.getAllByRole('option').map(option => option.textContent);
    expect(shown).toEqual(['Earthquake', 'Earth Power']);
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('option', { name: 'Earth Power' }));
    expect(onSelect).toHaveBeenCalledWith('Earth Power');
    expect(input).toHaveValue('Earth Power');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('arrow keys move the highlight and Enter commits it; Escape closes the list', async () => {
    const onSelect = vi.fn();
    render(<Host onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'e');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('Earth Power');
  });

  test('Enter on an exact spelling commits the option; unknown text goes to the free-text handler', async () => {
    const onSelect = vi.fn();
    const onEnterFreeText = vi.fn();
    render(<Host onSelect={onSelect} onEnterFreeText={onEnterFreeText} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'stone edge');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('Stone Edge');

    await userEvent.clear(input);
    await userEvent.type(input, 'Splash');
    expect(screen.getByText('No matching option')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onEnterFreeText).toHaveBeenCalledWith('Splash');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('blur closes the list and reports; a disabled box shows no list', async () => {
    const onBlur = vi.fn();
    render(<Host onSelect={vi.fn()} onBlur={onBlur} />);
    const input = screen.getByRole('combobox');
    await userEvent.click(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();

    render(<Host onSelect={vi.fn()} disabled />);
    const boxes = screen.getAllByRole('combobox');
    expect(boxes[1]).toBeDisabled();
  });
});
