import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewGameDialog } from '../../../src/components/NewGameDialog';
import { savedRecord } from '../fixtures/saved-game';

/**
 * Round 89 (lane H, #105), stage H4: the New game dialog (user ruling 13.11.2026: a modal, the simulator's problems under the team
 * with Start possible, the simulator's whole format list searchable and grouped, a fresh dice seed per game that the user can read
 * and set). The real simulator runs under it: the format list, the team check and Start are the engine's.
 */

const GOOD = `Garchomp @ Rocky Helmet
Ability: Rough Skin
EVs: 252 HP / 4 Def / 252 Spe
Jolly Nature
- Earthquake
- Dragon Tail
- Stealth Rock
- Spikes

Gliscor @ Toxic Orb
Ability: Poison Heal
EVs: 244 HP / 248 Def / 16 SpD
Impish Nature
- Earthquake
- Knock Off
- Spikes
- Protect`;
const LEVITATE = 'Garchomp @ Rocky Helmet\nAbility: Levitate\nEVs: 252 HP / 4 Def / 252 Spe\nJolly Nature\n- Earthquake\n- Dragon Tail';
const FOUR = ['Garchomp', 'Charizard', 'Tyranitar', 'Starmie', 'Snorlax', 'Gengar'].map(name => `${name}\n- Protect`).join('\n\n');

type Props = Parameters<typeof NewGameDialog>[0];
const props = (overrides: Partial<Props> = {}): Props => ({ open: true, onOpenChange: vi.fn(), onStart: vi.fn(), ...overrides });
const box = (side: 1 | 2) => screen.getByRole('textbox', { name: `Player ${side} team` });
const paste = (side: 1 | 2, text: string) => fireEvent.change(box(side), { target: { value: text } });
const start = () => screen.getByRole('button', { name: /^Start|Starting/ });

async function pickFormat(search: string, name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Format \[Gen / }));
  await user.type(screen.getByRole('combobox', { name: 'Search formats' }), search);
  await user.click(screen.getAllByRole('option').find(option => option.firstChild?.textContent === name)!);
}

beforeEach(() => localStorage.clear());

describe('the dialog', () => {
  test('closed it shows nothing; open it is a modal named New game with Start waiting for two teams', async () => {
    const { rerender } = render(<NewGameDialog {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<NewGameDialog {...props()} />);
    expect(screen.getByRole('dialog', { name: 'New game' })).toHaveAttribute('aria-modal', 'true');
    expect(start()).toBeDisabled();
    expect(screen.getByText('Paste a team for each player to start.')).toBeInTheDocument();
    paste(1, GOOD);
    expect(screen.getByText('Paste a team for Player 2 to start.')).toBeInTheDocument();
    paste(2, GOOD);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled(), { timeout: 30_000 });
  });

  test('Cancel and the close button end the dialog, and what was pasted is still there when it opens again', async () => {
    const wired = props();
    const { rerender } = render(<NewGameDialog {...wired} />);
    paste(1, GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(wired.onOpenChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Close new game' }));
    expect(wired.onOpenChange).toHaveBeenCalledTimes(2);
    rerender(<NewGameDialog {...wired} open={false} />);
    rerender(<NewGameDialog {...wired} />);
    expect(box(1)).toHaveValue(GOOD);
  });
});

describe('the format list', () => {
  test('the open list scrolls into the dialog, so its footnote is not cut by the dialog\'s bottom edge (H4h)', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<NewGameDialog {...props()} />);
      await userEvent.click(await screen.findByRole('button', { name: /^Format \[Gen 9\] OU/ }));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts.some(element => (element as HTMLElement).classList?.contains('ps-format-pop'))).toBe(true);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test('opens on the simulator\'s whole list: Calibrated and Custom Game on top, a group per generation, 178 formats to search', async () => {
    const user = userEvent.setup();
    render(<NewGameDialog {...props()} />);
    await user.click(await screen.findByRole('button', { name: /^Format \[Gen 9\] OU/ }));
    const search = screen.getByRole('combobox', { name: 'Search formats' });
    expect(search).toHaveAttribute('placeholder', 'Search 178 formats');
    const list = screen.getByRole('listbox', { name: 'Formats' });
    const headings = Array.from(list.querySelectorAll('.ps-combobox-group')).map(node => node.textContent);
    expect(headings).toEqual(['Calibrated', 'Custom Game', 'Champions', 'Gen 9', 'Gen 8', 'Gen 7', 'Gen 6', 'Gen 5', 'Gen 4', 'Gen 3', 'Gen 2', 'Gen 1']);
    const calibrated = within(list).getAllByRole('option').slice(0, 5).map(option => option.textContent);
    expect(calibrated).toEqual([
      '[Gen 9] OUsingles', '[Gen 9] Doubles OUdoubles', '[Gen 9] VGC 2025 Reg Idoubles · bring 4',
      '[Gen 9 Champions] OUsingles', '[Gen 9 Champions] VGC 2026 Reg M-Cdoubles · bring 4',
    ]);
    expect(within(list).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  }, 60_000);

  test('the search narrows the list by name or id, a pick sets the format and shows its facts, Escape closes only the list', async () => {
    const user = userEvent.setup();
    const wired = props();
    render(<NewGameDialog {...wired} />);
    await pickFormat('vgc 2025', '[Gen 9] VGC 2025 Reg I');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: /^Format \[Gen 9\] VGC 2025 Reg I/ })).toBeInTheDocument();
    expect(screen.getByText('doubles · bring 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Format \[Gen 9\] VGC 2025 Reg I/ }));
    await user.type(screen.getByRole('combobox', { name: 'Search formats' }), 'zzzz');
    expect(screen.getByText('No matching format')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(wired.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  }, 60_000);

  // Round 89 (#105, H7, tester finding 10): the dialog reads the format's rules from the Dex, never a list of generations.
  test('the intro says Team Preview only for a format that has one; Gen 4 OU and Gen 9 OU read from the Dex', async () => {
    render(<NewGameDialog {...props()} />);
    expect(screen.getByText(/Start opens the game at Team Preview/)).toBeInTheDocument();
    await pickFormat('gen4ou', '[Gen 4] OU');
    expect(screen.queryByText(/Start opens the game at Team Preview/)).toBeNull();
    expect(screen.getByText(/this format has no Team Preview/)).toBeInTheDocument();
    expect(screen.getByText('singles · no Team Preview')).toBeInTheDocument();
    await pickFormat('gen9ou', '[Gen 9] OU');
    expect(screen.getByText(/Start opens the game at Team Preview/)).toBeInTheDocument();
    expect(screen.getByText('singles')).toBeInTheDocument();
  }, 60_000);

  test('the arrow keys and Enter pick a format from the search field', async () => {
    const user = userEvent.setup();
    render(<NewGameDialog {...props()} />);
    await user.click(await screen.findByRole('button', { name: /^Format \[Gen 9\] OU/ }));
    await user.type(screen.getByRole('combobox', { name: 'Search formats' }), 'doubles ou{ArrowDown}{Enter}');
    expect(screen.getByRole('button', { name: /^Format / }).textContent).toMatch(/Doubles/);
  }, 60_000);
});

describe('a team box', () => {
  test('a sprite that does not load (a species no sprite sheet holds) drops out instead of showing its alt text (H4h)', () => {
    render(<NewGameDialog {...props()} />);
    paste(1, `Zzqxvwk\n- Tackle\n\n${GOOD}`);
    const read = document.querySelectorAll('.ps-newgame-read')[0] as HTMLElement;
    const broken = Array.from(read.querySelectorAll('img')).find(image => image.getAttribute('alt') === 'zzqxvwk')!;
    expect(broken).toBeDefined();
    fireEvent.error(broken);
    expect(broken).not.toBeVisible();
    expect(Array.from(read.querySelectorAll('img')).filter(image => !image.hidden)).toHaveLength(2);
  });

  test('shows the sprites of the sets it read and how many, and names a block without a move', async () => {
    render(<NewGameDialog {...props()} />);
    paste(1, `${GOOD}\n\nasdf asdf`);
    expect(await screen.findByText('2 of 6 sets read')).toBeInTheDocument();
    const read = document.querySelector('.ps-newgame-read')!;
    expect(Array.from(read.querySelectorAll('img')).map(image => image.getAttribute('alt'))).toEqual(['Garchomp', 'Gliscor']);
    expect(read.querySelector('img')!.getAttribute('src')).toBe('https://play.pokemonshowdown.com/sprites/gen5/garchomp.png');
    expect(screen.getByText(/No moves read for asdfasdf/)).toBeInTheDocument();
  });

  test('the simulator\'s problems show under the team and Start stays possible; a legal team says so', async () => {
    render(<NewGameDialog {...props()} />);
    paste(1, GOOD);
    paste(2, LEVITATE);
    expect(await screen.findByText('This team has 1 problem for [Gen 9] OU:', undefined, { timeout: 30_000 })).toBeInTheDocument();
    expect(screen.getByText("Garchomp can't have Levitate.")).toBeInTheDocument();
    expect(screen.getByText('This team is valid for [Gen 9] OU.')).toBeInTheDocument();
    expect(screen.getByText(/Start plays the team as pasted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  }, 60_000);

  test('Validate runs the check again and a Custom Game reads the project\'s ability rule', async () => {
    render(<NewGameDialog {...props()} />);
    paste(1, LEVITATE);
    paste(2, GOOD);
    await pickFormat('gen9 custom', '[Gen 9] Custom Game');
    expect(await screen.findByText('Garchomp cannot have the ability Levitate.', undefined, { timeout: 30_000 })).toBeInTheDocument();
    paste(1, GOOD);
    await userEvent.click(screen.getAllByRole('button', { name: 'Validate' })[0]);
    await waitFor(() => expect(screen.queryByText('Garchomp cannot have the ability Levitate.')).toBeNull(), { timeout: 30_000 });
  }, 90_000);
});

describe('the dice seed', () => {
  test('a fresh seed stands in the field, New seed draws another, a typed one is checked', async () => {
    const user = userEvent.setup();
    render(<NewGameDialog {...props()} />);
    const field = screen.getByRole('textbox', { name: 'Seed' });
    const first = (field as HTMLInputElement).value;
    expect(first).toMatch(/^\d+,\d+,\d+,\d+$/);
    // the row stands under the Format row, in the mock's words
    const format = document.querySelector('.ps-newgame-format') as HTMLElement;
    expect(format.nextElementSibling).toBe(document.querySelector('.ps-newgame-seed'));
    expect(screen.getByText('The same seed, teams and choices roll the same dice.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New seed' }));
    expect((field as HTMLInputElement).value).not.toBe(first);
    fireEvent.change(field, { target: { value: '1,2,3' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/four whole numbers/);
    paste(1, GOOD);
    paste(2, GOOD);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '1,2,3,4' } });
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    // a sodium seed of a Showdown input log is a seed too
    fireEvent.change(field, { target: { value: 'sodium,0123456789abcdef' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });
});

describe('Start', () => {
  test('starts the format\'s battle with the typed seed and the names, hands the record over and closes; the next game draws a new seed', async () => {
    const wired = props();
    render(<NewGameDialog {...wired} />);
    paste(1, GOOD);
    paste(2, GOOD);
    fireEvent.change(screen.getByRole('textbox', { name: 'Player 1 name' }), { target: { value: 'Tidepool' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Seed' }), { target: { value: '5,6,7,8' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(wired.onStart).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    const record = vi.mocked(wired.onStart).mock.calls[0][0];
    expect(record).toMatchObject({ format: 'gen9ou', formatName: '[Gen 9] OU', players: ['Tidepool', 'Player 2'], seed: '5,6,7,8', turns: 0, entries: [] });
    expect(record.teams.p1.map(set => set.species)).toEqual(['Garchomp', 'Gliscor']);
    expect(wired.onOpenChange).toHaveBeenLastCalledWith(false);
    expect((screen.getByRole('textbox', { name: 'Seed' }) as HTMLInputElement).value).not.toBe('5,6,7,8');
    expect(box(1)).toHaveValue(GOOD);
  }, 60_000);

  test('a species the format\'s Dex does not know is a problem under its box and Start says why it cannot start, in plain words (H4h)', async () => {
    const wired = props();
    render(<NewGameDialog {...wired} />);
    paste(1, `Zzqxvwk @ Leftovers\nAbility: Pressure\n- Tackle\n\n${GOOD}`);
    paste(2, GOOD);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
    await waitFor(() => expect(screen.getByText(/does not exist/)).toBeInTheDocument(), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('The game could not start: zzqxvwk is no Pokémon of [Gen 9] OU. Fix the set to start.', undefined, { timeout: 30_000 })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Cannot read properties/);
    expect(wired.onStart).not.toHaveBeenCalled();
  }, 60_000);

  test('a failure shows its message and keeps the dialog open', async () => {
    const wired = props({ onStart: vi.fn().mockRejectedValue(new Error('boom')) });
    render(<NewGameDialog {...wired} />);
    paste(1, GOOD);
    paste(2, GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('The game could not start: boom', undefined, { timeout: 30_000 })).toBeInTheDocument();
    expect(wired.onOpenChange).not.toHaveBeenCalled();
  }, 60_000);

  const FAMILIES: [string, string, string][] = [
    ['singles', 'gen9 ou', '[Gen 9] OU'],
    ['doubles', 'doubles ou', '[Gen 9] Doubles OU'],
    ['VGC, Scarlet and Violet', 'vgc 2025', '[Gen 9] VGC 2025 Reg I'],
    ['Champions singles', 'champions ou', '[Gen 9 Champions] OU'],
    ['Champions VGC', 'champions vgc', '[Gen 9 Champions] VGC 2026 Reg M-C'],
  ];
  for (const [label, search, name] of FAMILIES) {
    test(`${label}: ${name} starts from two pasted teams at Team Preview`, async () => {
      const wired = props();
      render(<NewGameDialog {...wired} />);
      await pickFormat(search, name);
      paste(1, FOUR);
      paste(2, FOUR);
      await userEvent.click(screen.getByRole('button', { name: 'Start' }));
      await waitFor(() => expect(wired.onStart).toHaveBeenCalledTimes(1), { timeout: 30_000 });
      const record = vi.mocked(wired.onStart).mock.calls[0][0];
      expect(record.formatName).toBe(name);
      expect(record.header.some(line => line.startsWith('|teampreview'))).toBe(true);
      expect(record.entries).toEqual([]);
    }, 60_000);
  }
});

describe('the saved games', () => {
  test('the dialog holds only the new game: saved games are listed in the Game menu and on the start page, never here (H11a)', async () => {
    await savedRecord();
    render(<NewGameDialog {...props()} />);
    expect(screen.getByRole('dialog', { name: 'New game' })).toBeInTheDocument();
    expect(screen.queryByText('Saved games')).toBeNull();
    expect(document.querySelector('.ps-newgame-saved')).toBeNull();
  }, 60_000);
});

/**
 * Round 89 (lane H, #105), H16a: Start asks first when an unsaved variation is open. The question stands in the dialog (the dialog is
 * modal), keeps the pasted teams, and Cancel starts nothing. Singles and doubles start through the same line.
 */
describe('Start with an unsaved variation open (H16a)', () => {
  for (const [label, search, name] of [['singles', 'gen9ou', '[Gen 9] OU'], ['doubles', 'doubles ou', '[Gen 9] Doubles OU']]) {
    test(`${label}: the question comes before Start; Cancel starts nothing and keeps the teams, Discard variation starts the game`, async () => {
      const wired = props({ unsavedVariation: () => true });
      render(<NewGameDialog {...wired} />);
      await pickFormat(search, name);
      paste(1, FOUR);
      paste(2, FOUR);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled(), { timeout: 30_000 });
      await userEvent.click(screen.getByRole('button', { name: 'Start' }));
      const question = screen.getByRole('alertdialog');
      expect(question).toHaveTextContent('The open variation is not saved. Starting a game closes it.');
      expect(wired.onStart).not.toHaveBeenCalled();
      await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(wired.onStart).not.toHaveBeenCalled();
      expect(box(1)).toHaveValue(FOUR);
      await userEvent.click(screen.getByRole('button', { name: 'Start' }));
      await userEvent.click(screen.getByRole('button', { name: 'Discard variation' }));
      await waitFor(() => expect(wired.onStart).toHaveBeenCalledTimes(1), { timeout: 30_000 });
      expect(vi.mocked(wired.onStart).mock.calls[0][0].formatName).toBe(name);
    }, 90_000);
  }

  test('no unsaved variation: Start goes straight on', async () => {
    const wired = props({ unsavedVariation: () => false });
    render(<NewGameDialog {...wired} />);
    paste(1, FOUR);
    paste(2, FOUR);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled(), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(wired.onStart).toHaveBeenCalledTimes(1), { timeout: 30_000 });
  }, 60_000);

  test('closing the dialog drops an open question', async () => {
    const wired = props({ unsavedVariation: () => true });
    const { rerender } = render(<NewGameDialog {...wired} />);
    paste(1, FOUR);
    paste(2, FOUR);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled(), { timeout: 30_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    rerender(<NewGameDialog {...wired} open={false} />);
    rerender(<NewGameDialog {...wired} open />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  }, 60_000);
});
