import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewGameDialog } from '../../../src/components/NewGameDialog';
import { GAMES_INDEX_KEY, gameKey, listGames, saveGame } from '../../../src/lib/new-game/store';
import { newGameRecord } from '../../../src/lib/new-game/record';
import { startGameLog } from '@fulllifegames/eval-engine';
import { readTeamPaste } from '../../../src/lib/new-game/start';

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
const props = (overrides: Partial<Props> = {}): Props => ({ open: true, onOpenChange: vi.fn(), onStart: vi.fn(), onOpenSaved: vi.fn(), ...overrides });
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

  test('the arrow keys and Enter pick a format from the search field', async () => {
    const user = userEvent.setup();
    render(<NewGameDialog {...props()} />);
    await user.click(await screen.findByRole('button', { name: /^Format \[Gen 9\] OU/ }));
    await user.type(screen.getByRole('combobox', { name: 'Search formats' }), 'doubles ou{ArrowDown}{Enter}');
    expect(screen.getByRole('button', { name: /^Format / }).textContent).toMatch(/Doubles/);
  }, 60_000);
});

describe('a team box', () => {
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
    const field = screen.getByRole('textbox', { name: 'Dice seed' });
    const first = (field as HTMLInputElement).value;
    expect(first).toMatch(/^\d+,\d+,\d+,\d+$/);
    await user.click(screen.getByRole('button', { name: 'New seed' }));
    expect((field as HTMLInputElement).value).not.toBe(first);
    fireEvent.change(field, { target: { value: '1,2,3' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/four whole numbers/);
    paste(1, GOOD);
    paste(2, GOOD);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '1,2,3,4' } });
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Dice seed' }), { target: { value: '5,6,7,8' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(wired.onStart).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    const record = vi.mocked(wired.onStart).mock.calls[0][0];
    expect(record).toMatchObject({ format: 'gen9ou', formatName: '[Gen 9] OU', players: ['Tidepool', 'Player 2'], seed: '5,6,7,8', turns: 0, entries: [] });
    expect(record.teams.p1.map(set => set.species)).toEqual(['Garchomp', 'Gliscor']);
    expect(wired.onOpenChange).toHaveBeenLastCalledWith(false);
    expect((screen.getByRole('textbox', { name: 'Dice seed' }) as HTMLInputElement).value).not.toBe('5,6,7,8');
    expect(box(1)).toHaveValue(GOOD);
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
  async function savedGame(players: [string, string], turns: number, seed: string) {
    const start = await startGameLog({ format: 'gen9ou', p1Team: readTeamPaste(GOOD).sets, p2Team: readTeamPaste(GOOD).sets, playerNames: players, seed });
    const record = { ...newGameRecord({ start, formatName: '[Gen 9] OU', players, seed, now: new Date(Date.UTC(2026, 10, 11, 20, 40 + turns)) }), turns };
    expect(saveGame(record)).toBe(true);
    return record;
  }

  test('lists each game with its format, names, turns, date and seed; Open hands the record over and closes', async () => {
    const first = await savedGame(['Alice', 'Bob'], 14, '3,4,5,6');
    await savedGame(['Cleo', 'Dan'], 1, '7,8,9,10');
    const wired = props();
    render(<NewGameDialog {...wired} />);
    const rows = Array.from(document.querySelectorAll('.ps-newgame-saved-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Cleo');
    expect(rows[0]).toHaveTextContent('1 turn played');
    expect(rows[0]).toHaveTextContent('seed 7,8,9,10');
    expect(rows[1]).toHaveTextContent('[Gen 9] OU');
    expect(rows[1]).toHaveTextContent('14 turns played');
    await userEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(wired.onOpenSaved).toHaveBeenCalledTimes(1));
    expect(vi.mocked(wired.onOpenSaved).mock.calls[0][0].id).toBe(first.id);
    expect(wired.onOpenChange).toHaveBeenLastCalledWith(false);
  }, 60_000);

  test('Delete asks once in the row; Keep leaves the game, Delete removes it and what it owns', async () => {
    const record = await savedGame(['Alice', 'Bob'], 3, '3,4,5,6');
    localStorage.setItem(`ps-replay-interceptor:branches:${record.id}`, '[]');
    render(<NewGameDialog {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved game' }));
    expect(screen.getByText('Delete this game?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(listGames()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(listGames()).toEqual([]);
    expect(localStorage.getItem(gameKey(record.id))).toBeNull();
    expect(localStorage.getItem(`ps-replay-interceptor:branches:${record.id}`)).toBeNull();
    expect(localStorage.getItem(GAMES_INDEX_KEY)).toBe('[]');
    expect(document.querySelector('.ps-newgame-saved')).toBeNull();
  }, 60_000);

  test('the game that is open now cannot be deleted from under itself, and an unreadable save says so', async () => {
    const record = await savedGame(['Alice', 'Bob'], 3, '3,4,5,6');
    const { rerender } = render(<NewGameDialog {...props({ currentGameId: record.id })} />);
    expect(screen.queryByRole('button', { name: 'Delete saved game' })).toBeNull();
    expect(screen.getByText('open now')).toBeInTheDocument();
    localStorage.setItem(gameKey(record.id), '{broken');
    rerender(<NewGameDialog {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That saved game could not be read.');
  }, 60_000);
});
