import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import type { Battle } from '@pkmn/sim';
import { createBranchStateFromBattle, type BranchSlotChoice, type ForcedDie } from '@fulllifegames/eval-engine';
import { BranchPanel } from '../../../src/components/BranchPanel';
import { diceBattle, setOf } from '../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7a: the chips of Advanced on a real battle. The panel asks the simulator which dice the chosen
 * move draws, shows one set of chips per slot (one per target of a spread move), and a click edits the slot's choice, which the
 * panel hands to `onSetChoice` like any other pick. Basic shows no chips.
 */
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => [] }));

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

/** The panel over a live battle with its own picks, as the app keeps them. `latest` shows what the app would hold. */
function renderPanel(battle: Battle, options: { advanced?: boolean; live?: boolean; first?: Picks } = {}) {
  const { advanced = true, live = true, first = { p1: [], p2: [] } } = options;
  localStorage.setItem('ps-replay-interceptor:picker-advanced', advanced ? '1' : '0');
  const latest: { picks: Picks } = { picks: first };
  function Host() {
    const [picks, setPicks] = useState<Picks>(first);
    const simState = useMemo(() => createBranchStateFromBattle(battle as never, [], { p1Choices: picks.p1, p2Choices: picks.p2 }), [picks]);
    return (
      <BranchPanel
        simState={simState} executeError={null} executing={false} gen={9} positionKey="dice"
        onSetChoice={(side, choice, slot = 0) => setPicks(held => {
          const next = { ...held, [side]: [...held[side]] };
          next[side][slot] = choice;
          latest.picks = next;
          return next;
        })}
        onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()}
        {...(live ? { getBattle: () => battle as never } : {})}
      />
    );
  }
  render(<Host />);
  return latest;
}

const side = (label: string) => {
  const heading = [...document.querySelectorAll('.ps-side-label')].find(entry => entry.textContent === label)!;
  return within(heading.closest('.ps-side-controls') as HTMLElement);
};

const singles = () => diceBattle({
  p1: [setOf('Noivern', ['airslash', 'splash'])], p2: [setOf('Snorlax', ['splash'])],
});

const diceOf = (picks: Picks, who: 'p1' | 'p2', slot = 0): ForcedDie[] | undefined => picks[who][slot]?.dice;
const kinds = (dice: ForcedDie[] | undefined) => dice?.map(die => [die.name.kind, die.result]);
const settle = () => new Promise(resolve => setTimeout(resolve, 250));

describe('BranchPanel dice chips', () => {
  test('Basic shows no chips, even with a move chosen', async () => {
    renderPanel(singles(), { advanced: false, first: { p1: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash' }], p2: [] } });
    await screen.findByRole('button', { name: /Air Slash/ });
    await settle();
    expect(screen.queryByRole('group', { name: /Dice for/ })).toBeNull();
  });

  test('without the branch battle there are no chips to offer', async () => {
    renderPanel(singles(), { live: false, first: { p1: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash' }], p2: [] } });
    await screen.findByRole('button', { name: /Air Slash/ });
    await settle();
    expect(screen.queryByRole('group', { name: /Dice for/ })).toBeNull();
  });

  test('a chosen move shows its dice, a click forces a result and a second click gives it back', async () => {
    const latest = renderPanel(singles());
    await userEvent.click(await side('P1').findByRole('button', { name: /Air Slash/ }));
    const dice = await screen.findByRole('group', { name: 'Dice for P1' });
    for (const caption of ['Hit', 'Crit', 'Flinch']) expect(within(dice).getByRole('group', { name: caption })).toBeInTheDocument();
    expect(within(within(dice).getByRole('group', { name: 'Hit' })).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Hits', 'Misses']);
    expect(within(dice).getByRole('combobox', { name: 'Damage roll' })).toBeInTheDocument();

    await userEvent.click(within(within(dice).getByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' }));
    expect(diceOf(latest.picks, 'p1')).toEqual([
      { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'flinch' }, result: { happens: true } },
    ]);
    const chip = () => within(screen.getByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' });
    await waitFor(() => expect(chip()).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(chip());
    expect('dice' in latest.picks.p1[0]!).toBe(false);
    await waitFor(() => expect(chip()).toHaveAttribute('aria-pressed', 'false'));
  });

  test('the other result of a die replaces the first, and the damage roll is a select', async () => {
    const latest = renderPanel(singles());
    await userEvent.click(await side('P1').findByRole('button', { name: /Air Slash/ }));
    const crit = () => screen.getByRole('group', { name: 'Crit' });
    await userEvent.click(await within(await screen.findByRole('group', { name: 'Crit' })).findByRole('button', { name: 'Crit' }));
    await userEvent.click(within(crit()).getByRole('button', { name: 'No crit' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['crit', { happens: false }]]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Damage roll' }), '15');
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['crit', { happens: false }], ['damage-roll', { step: 15 }]]);
  });

  test('a new move for the slot gives its dice back to the seed', async () => {
    const latest = renderPanel(singles());
    await userEvent.click(await side('P1').findByRole('button', { name: /Air Slash/ }));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' }));
    expect(diceOf(latest.picks, 'p1')).toHaveLength(1);
    await userEvent.click(side('P1').getByRole('button', { name: /Splash/ }));
    expect('dice' in latest.picks.p1[0]!).toBe(false);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Flinch' })).toBeNull());
  });

  test('a die the panel does not offer any more stays visible as a set chip and clears on a click', async () => {
    const stray: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'confusion' }, result: { happens: true } };
    const latest = renderPanel(singles(), { first: { p1: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash', dice: [stray] }], p2: [] } });
    const chip = await screen.findByRole('button', { name: 'Confusion' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip);
    expect('dice' in latest.picks.p1[0]!).toBe(false);
  });
});

const doubles = () => diceBattle({
  format: 'gen9doublescustomgame',
  p1: [setOf('Garchomp', ['rockslide', 'splash'], { name: 'Chomp' }), setOf('Blissey', ['splash'])],
  p2: [setOf('Snorlax', ['splash']), setOf('Chansey', ['splash'])],
});

describe('BranchPanel dice chips in doubles', () => {
  test('a spread move shows one set of chips per target, each target named', async () => {
    const latest = renderPanel(doubles());
    await userEvent.click(await side('P1A').findByRole('button', { name: /Rock Slide/ }));
    const dice = await screen.findByRole('group', { name: 'Dice for P1A' });
    for (const name of ['Snorlax', 'Chansey']) {
      expect(await within(dice).findByRole('group', { name: `Hit against ${name}` })).toBeInTheDocument();
      expect(within(dice).getByRole('group', { name: `Flinch against ${name}` })).toBeInTheDocument();
    }
    await userEvent.click(within(within(dice).getByRole('group', { name: 'Flinch against Chansey' })).getByRole('button', { name: 'Flinch' }));
    expect(diceOf(latest.picks, 'p1')?.map(die => [die.name.targetSlot, die.name.kind, die.result])).toEqual([['p2b', 'secondary', { happens: true }]]);
  });
});

describe('BranchPanel dice of the turn', () => {
  const tied = () => diceBattle({
    p1: [setOf('Snorlax', ['tackle'], { name: 'Alpha Mon' })], p2: [setOf('Snorlax', ['tackle', 'splash'], { name: 'Beta Mon' })],
  });
  const tackle: BranchSlotChoice = { kind: 'move', moveId: 'tackle', moveName: 'Tackle' };

  test('two bodies that tie in speed get a speed tie chip once both sides chose, set on the lower slot', async () => {
    const latest = renderPanel(tied(), { first: { p1: [tackle], p2: [tackle] } });
    const order = await screen.findByRole('group', { name: 'Move order' });
    expect(within(order).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Alpha Mon first', 'Beta Mon first']);
    await userEvent.click(within(order).getByRole('button', { name: 'Beta Mon first' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['speed-tie', { first: 'p2a' }]]);
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Move order' })).getByRole('button', { name: 'Beta Mon first' })).toHaveAttribute('aria-pressed', 'true'));
  });

  test('a Pokémon with an end-of-turn die gets an End of turn row', async () => {
    const battle = diceBattle({
      p1: [setOf('Snorlax', ['splash'])], p2: [setOf('Tropius', ['splash'], { ability: 'Harvest', item: 'Sitrus Berry' })],
    });
    const splash: BranchSlotChoice = { kind: 'move', moveId: 'splash', moveName: 'Splash' };
    const latest = renderPanel(battle, { first: { p1: [splash], p2: [splash] } });
    const row = await screen.findByRole('group', { name: 'End of turn for Tropius' });
    expect(within(row).getByRole('group', { name: 'Harvest' })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Triggers' }));
    expect(diceOf(latest.picks, 'p2')?.map(die => [die.name.slot, die.name.kind, die.result])).toEqual([['p2a', 'end-of-turn', { happens: true }]]);
  });

  test('before both sides chose there is no row for the turn', async () => {
    renderPanel(tied(), { first: { p1: [tackle], p2: [] } });
    await settle();
    expect(screen.queryByRole('group', { name: 'Dice of the turn' })).toBeNull();
  });
});
