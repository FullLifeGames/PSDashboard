import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle, type BranchSimState } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { typeBg } from '../../../../src/lib/type-colors';

/**
 * Round 69 (T182), moved to the dock in round 84 (A3b): with the Tera toggle pressed, a move tile reads the type the move lands
 * with after the click (Tera Blast Fairy, Tera Starstorm Stellar), in its tag and its color. The state is the engine's real one,
 * built from simulator battles. Singles and doubles share the tray; VGC is a doubles format and takes the same path. The compact
 * tooltip that started with the type is gone with the compact chips: the tag shows the type.
 */
const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '', ...extra,
});

function stateOf(format: string, p1: PokemonSet[], p2: PokemonSet[]): BranchSimState {
  const battle = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return createBranchStateFromBattle(battle, [], {});
}

const chomp = () => set('Garchomp', ['splash', 'terablast', 'earthquake'], { teraType: 'Fairy' });
const pagos = () => set('Terapagos', ['splash', 'terastarstorm'], { ability: 'Tera Shift', teraType: 'Stellar' });
const foe = (species: string) => set(species, ['splash']);

function dock(state: BranchSimState) {
  return render(<TurnDock simState={state} executeError={null} executing={false} gen={9} onSetChoice={vi.fn()} onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()} />);
}

/** Opens the tray of a slot (P1 in singles, P1A and P1B in doubles). */
const open = (label: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }));
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);
const tile = (move: RegExp) => tray().getByRole('button', { name: move });
const toggle = () => tray().getByRole('button', { name: /^Tera \(/ });

describe('the Tera toggle labels the move tiles (T182)', () => {
  test('singles: Tera Blast reads Normal, then Fairy once the toggle is pressed; other moves stay', async () => {
    dock(stateOf('gen9customgame', [chomp()], [foe('Snorlax')]));
    await open('P1');
    expect(tile(/Tera Blast/)).toHaveTextContent('Normal');
    // the tinted tile carries its full type color as --type (typeTileVars)
    expect(tile(/Tera Blast/).style.getPropertyValue('--type')).toBe(typeBg('Normal'));
    await userEvent.click(toggle());
    expect(tile(/Tera Blast/)).toHaveTextContent('Fairy');
    expect(within(tile(/Tera Blast/)).getByText('Fairy')).toHaveClass('ps-type-tag');
    expect(tile(/Tera Blast/).style.getPropertyValue('--type')).toBe(typeBg('Fairy'));
    expect(tile(/Earthquake/)).toHaveTextContent('Ground');
    await userEvent.click(toggle());
    expect(tile(/Tera Blast/)).toHaveTextContent('Normal');
  });

  test('singles: Terapagos-Terastal reads Stellar for Tera Starstorm when pressed', async () => {
    dock(stateOf('gen9customgame', [pagos()], [foe('Snorlax')]));
    await open('P1');
    expect(tile(/Tera Starstorm/)).toHaveTextContent('Normal');
    await userEvent.click(toggle());
    expect(tile(/Tera Starstorm/)).toHaveTextContent('Stellar');
    expect(tile(/Tera Starstorm/).style.getPropertyValue('--type')).toBe(typeBg('Stellar'));
  });

  test('doubles (VGC takes the same path): only the slot whose toggle is pressed changes, the partner stays', async () => {
    dock(stateOf('gen9doublescustomgame', [chomp(), pagos()], [foe('Snorlax'), foe('Blissey')]));
    await open('P1A');
    await userEvent.click(toggle());
    expect(tile(/Tera Blast/)).toHaveTextContent('Fairy');
    // The partner's toggle is held by slot A (one Tera per side and turn) and its labels stay Normal.
    await open('P1B');
    expect(toggle()).toBeDisabled();
    expect(tile(/Tera Starstorm/)).toHaveTextContent('Normal');
    await open('P1A');
    await userEvent.click(toggle());
    await open('P1B');
    await userEvent.click(toggle());
    expect(tile(/Tera Starstorm/)).toHaveTextContent('Stellar');
    await open('P1A');
    expect(tile(/Tera Blast/)).toHaveTextContent('Normal');
  });

  test('a tile without a label under Tera keeps its type when the toggle is pressed', async () => {
    dock(stateOf('gen9customgame', [set('Garchomp', ['earthquake'], { teraType: 'Fairy' })], [foe('Snorlax')]));
    await open('P1');
    await userEvent.click(toggle());
    expect(tile(/Earthquake/)).toHaveTextContent('Ground');
  });
});
