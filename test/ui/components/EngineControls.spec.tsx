import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineControls } from '../../../src/components/eval/EngineControls';
import { BUILTIN_ENGINE, type EngineEntry } from '../../../src/lib/engines/registry';

const bot: EngineEntry = { id: 'url:http://localhost:8765/', name: 'My bot', url: 'http://localhost:8765/', source: 'added' };

function wired(engines: EngineEntry[], selected = engines[0]) {
  return { engines, selected, running: false, onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
}

describe('the engine controls (round 77, user gate 28.10.2026: the dropdown appears once another engine is integrated)', () => {
  test('with the own engine alone there is no dropdown, only the way to add one', () => {
    render(<EngineControls {...wired([BUILTIN_ENGINE])} />);
    expect(screen.queryByRole('combobox', { name: 'Engine' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ engine' })).toBeInTheDocument();
  });

  test('a second engine brings the dropdown; a pick reaches the handler', async () => {
    const props = wired([BUILTIN_ENGINE, bot]);
    render(<EngineControls {...props} />);
    const select = screen.getByRole('combobox', { name: 'Engine' });
    expect(select).toHaveValue('ps-dashboard');
    await userEvent.selectOptions(select, 'url:http://localhost:8765/');
    expect(props.onSelect).toHaveBeenCalledWith('url:http://localhost:8765/');
  });

  test('the add dialog takes a name and an address, refuses a bad address, and lists added engines for removal', async () => {
    const props = wired([BUILTIN_ENGINE, bot]);
    render(<EngineControls {...props} />);
    await userEvent.click(screen.getByRole('button', { name: '+ engine' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Other bot');
    await userEvent.type(screen.getByRole('textbox', { name: 'Address' }), 'ftp://example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Add engine' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The address must start with http:// or https://.');
    expect(props.onAdd).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Address' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Address' }), 'http://localhost:9000/');
    await userEvent.click(screen.getByRole('button', { name: 'Add engine' }));
    expect(props.onAdd).toHaveBeenCalledWith('Other bot', 'http://localhost:9000/');

    await userEvent.click(screen.getByRole('button', { name: '+ engine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove My bot' }));
    expect(props.onRemove).toHaveBeenCalledWith('url:http://localhost:8765/');
  });
});
