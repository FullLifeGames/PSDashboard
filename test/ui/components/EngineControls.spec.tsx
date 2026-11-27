import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineControls } from '../../../src/components/eval/EngineControls';
import { BUILTIN_ENGINE, type EngineEntry } from '../../../src/lib/engines/registry';

const bot: EngineEntry = { id: 'url:http://localhost:8765/', name: 'My bot', url: 'http://localhost:8765/', source: 'added' };

function wired(engines: EngineEntry[]) {
  return { engines, onAdd: vi.fn(), onRemove: vi.fn() };
}

describe('the engine controls (the header keeps only the way to add an engine)', () => {
  test.each([['the built-in engine alone', [BUILTIN_ENGINE]], ['an added engine', [BUILTIN_ENGINE, bot]]])('with %s the header draws the add button and no select', (_scene, engines) => {
    render(<EngineControls {...wired(engines)} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: '+ engine' })).toBeInTheDocument();
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
