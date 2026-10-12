import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle, type BranchSimState } from '@fulllifegames/eval-engine';
import { FightSection } from '../../../src/components/branch/FightSection';
import { useGimmickToggles } from '../../../src/hooks/useSideControlsState';
import { typeBg } from '../../../src/lib/type-colors';

/**
 * Round 69 (T182): with the Tera toggle pressed, a move button reads the type
 * the move lands with after the click (Tera Blast Fairy, Tera Starstorm
 * Stellar), in the label, the colour and the compact tooltip. The state is the
 * engine's real one, built from simulator battles. Singles and doubles share
 * the FightSection code; VGC is a doubles format and takes the same path.
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

/** One FightSection per p1 slot over the panel's real gimmick toggles. */
function Host({ state, advanced }: { state: BranchSimState; advanced: boolean }) {
  const toggles = useGimmickToggles(state.p1ModifiersBySlot, []);
  return (
    <>
      {state.p1MovesBySlot.map((moves, slot) => (
        <section key={slot} aria-label={`Slot ${slot}`}>
          <FightSection
            label={`P1${slot}`} activeSpecies={state.p1ActiveSlots[slot]?.species ?? ''} moves={moves} switches={[]}
            pending={null} blockedSwitchKeys={new Set()} modifiers={state.p1ModifiersBySlot[slot]} dmgResults={[]}
            spreadDamageResults={{}} targetDamageResults={{}} advanced={advanced} movePool={[]} onChoice={vi.fn()}
            onHypotheticalMove={vi.fn()} gimmick={toggles.gimmickFor('p1', slot)}
            whatIf={{ whatIfMove: '', setWhatIfMove: vi.fn(), whatIfReplace: null, setWhatIfReplace: vi.fn() }}
          />
        </section>
      ))}
    </>
  );
}

const button = (slot: number, move: RegExp) => within(screen.getByRole('region', { name: `Slot ${slot}` })).getByRole('button', { name: move });
const toggle = (slot: number) => within(screen.getByRole('region', { name: `Slot ${slot}` })).getByRole('button', { name: /^Tera \(/ });

describe('the Tera toggle labels the move buttons (T182)', () => {
  test('singles: Tera Blast reads Normal, then Fairy once the toggle is pressed; other moves stay', async () => {
    render(<Host state={stateOf('gen9customgame', [chomp()], [foe('Snorlax')])} advanced />);
    expect(button(0, /Tera Blast/)).toHaveTextContent('Normal');
    expect(button(0, /Tera Blast/)).toHaveStyle({ background: typeBg('Normal') });
    await userEvent.click(toggle(0));
    expect(button(0, /Tera Blast/)).toHaveTextContent('Fairy');
    expect(within(button(0, /Tera Blast/)).getByText('Fairy')).toHaveClass('ps-movebtn-type');
    expect(button(0, /Tera Blast/)).toHaveStyle({ background: typeBg('Fairy') });
    expect(button(0, /Earthquake/)).toHaveTextContent('Ground');
    await userEvent.click(toggle(0));
    expect(button(0, /Tera Blast/)).toHaveTextContent('Normal');
  });

  test('singles, compact: the tooltip starts with the type under the pressed toggle', async () => {
    render(<Host state={stateOf('gen9customgame', [chomp()], [foe('Snorlax')])} advanced={false} />);
    expect(button(0, /Tera Blast/)).toHaveAttribute('title', expect.stringMatching(/^Normal · /));
    await userEvent.click(toggle(0));
    expect(button(0, /Tera Blast/)).toHaveAttribute('title', expect.stringMatching(/^Fairy · /));
    expect(button(0, /Earthquake/)).toHaveAttribute('title', expect.stringMatching(/^Ground · /));
  });

  test('singles: Terapagos-Terastal reads Stellar for Tera Starstorm when pressed', async () => {
    render(<Host state={stateOf('gen9customgame', [pagos()], [foe('Snorlax')])} advanced />);
    expect(button(0, /Tera Starstorm/)).toHaveTextContent('Normal');
    await userEvent.click(toggle(0));
    expect(button(0, /Tera Starstorm/)).toHaveTextContent('Stellar');
    expect(button(0, /Tera Starstorm/)).toHaveStyle({ background: typeBg('Stellar') });
  });

  test('doubles (VGC takes the same path): only the slot whose toggle is pressed changes, the partner stays', async () => {
    render(<Host state={stateOf('gen9doublescustomgame', [chomp(), pagos()], [foe('Snorlax'), foe('Blissey')])} advanced />);
    await userEvent.click(toggle(0));
    expect(button(0, /Tera Blast/)).toHaveTextContent('Fairy');
    // The partner's toggle is held by slot 0 (one Tera per side and turn) and its labels stay Normal.
    expect(toggle(1)).toBeDisabled();
    expect(button(1, /Tera Starstorm/)).toHaveTextContent('Normal');
    await userEvent.click(toggle(0));
    await userEvent.click(toggle(1));
    expect(button(1, /Tera Starstorm/)).toHaveTextContent('Stellar');
    expect(button(0, /Tera Blast/)).toHaveTextContent('Normal');
  });

  test('a button without a label under Tera keeps its type when the toggle is pressed', async () => {
    render(<Host state={stateOf('gen9customgame', [set('Garchomp', ['earthquake'], { teraType: 'Fairy' })], [foe('Snorlax')])} advanced />);
    await userEvent.click(toggle(0));
    expect(button(0, /Earthquake/)).toHaveTextContent('Ground');
  });
});
